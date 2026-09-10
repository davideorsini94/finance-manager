import type { ConfigService } from '@nestjs/config';
import { LlmModelsService } from './llm-models.service';
import type { LlmConfigService, LlmConfigStatus } from './llm-config.service';
import type { OpencodeAvailabilityService } from './opencode-availability.service';
import type { OpencodeClient, OpencodeTier } from './opencode.client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * La tendina delle impostazioni deve proporre SOLO modelli verificati, e se
 * cade il modello **attivo** l'app deve passare da sé a uno che funziona: un
 * modello morto in configurazione significa chat rotta a ogni messaggio.
 */
describe('getOpencodeModels e auto-riparazione del modello attivo', () => {
  function snapshot(tier: OpencodeTier, working: string[], brokenIds: string[] = []) {
    return {
      tier,
      checkedAt: new Date('2026-09-10T10:00:00Z'),
      models: [
        ...working.map((modelId) => ({ modelId, ok: true, status: null, detail: null })),
        ...brokenIds.map((modelId) => ({
          modelId,
          ok: false,
          status: 500,
          detail: 'Internal server error',
        })),
      ],
    };
  }

  function build(opts: {
    activeModel: string;
    tier: OpencodeTier | null;
    working: string[];
    broken?: string[];
    key?: string;
    provider?: 'ollama' | 'opencode';
  }) {
    const status: LlmConfigStatus = {
      provider: opts.provider ?? 'opencode',
      activeModel: opts.activeModel,
      source: 'db',
      reportPrompt: '',
      opencode: {
        configured: true,
        apiKeyMasked: 'sk-…',
        tier: opts.tier,
        model: opts.activeModel,
      },
    };
    const llmConfig = {
      getStatus: jest.fn(async () => status),
      getOpencodeKey: jest.fn(async () => opts.key ?? 'sk-test'),
      setOpencodeModel: jest.fn(async (_userId: string | null, model: string) => ({
        provider: 'opencode' as const,
        model,
        source: 'db' as const,
      })),
    };
    const availability = {
      get: jest.fn(async (tier: OpencodeTier) => ({
        snapshot: snapshot(tier, opts.working, opts.broken),
        refreshing: false,
      })),
      whenIdle: jest.fn(async () => undefined),
      invalidate: jest.fn(),
    };
    const notifications = {
      create: jest.fn(
        async (_input: { userId: string; type: string; title: string; body?: string | null }) =>
          null,
      ),
    };
    const prisma = {
      user: { findMany: jest.fn(async () => [{ id: 'admin-1' }, { id: 'admin-2' }]) },
    };
    const service = new LlmModelsService(
      { get: () => undefined } as unknown as ConfigService,
      llmConfig as unknown as LlmConfigService,
      { listModels: jest.fn(async () => opts.working) } as unknown as OpencodeClient,
      availability as unknown as OpencodeAvailabilityService,
      notifications as unknown as NotificationsService,
      prisma as unknown as PrismaService,
    );
    return { service, llmConfig, availability, notifications, prisma };
  }

  it('propone solo i modelli che funzionano e dice quanti ne ha esclusi', async () => {
    const { service } = build({
      activeModel: 'deepseek-v4-flash',
      tier: 'go',
      working: ['deepseek-v4-flash', 'kimi-k3'],
      broken: ['muse-spark-1.3-contributor', 'gpt-5.6-luna'],
    });
    const res = await service.getOpencodeModels();
    expect(res.models.map((m) => m.modelId)).toEqual(['deepseek-v4-flash', 'kimi-k3']);
    expect(res.excludedCount).toBe(2);
    expect(res.checkedAt).toBe('2026-09-10T10:00:00.000Z');
    expect(res.refreshing).toBe(false);
  });

  it('se il modello attivo non è più servito passa a uno funzionante e avvisa gli admin', async () => {
    const { service, llmConfig, notifications } = build({
      activeModel: 'muse-spark-1.3-contributor',
      tier: 'go',
      working: ['glm-5.2', 'deepseek-v4-flash'],
      broken: ['muse-spark-1.3-contributor'],
    });
    await service.getOpencodeModels();
    // Cambio di sistema: nessun admin l'ha chiesto, quindi updatedBy è null.
    expect(llmConfig.setOpencodeModel).toHaveBeenCalledWith(null, 'deepseek-v4-flash');
    expect(notifications.create).toHaveBeenCalledTimes(2);
    const notifica = notifications.create.mock.calls[0][0];
    expect(notifica).toMatchObject({ userId: 'admin-1', type: 'system' });
    expect(`${notifica.title} ${notifica.body}`).toContain('muse-spark-1.3-contributor');
    expect(`${notifica.title} ${notifica.body}`).toContain('deepseek-v4-flash');
  });

  it('se il gateway non elenca più il modello attivo lo sostituisce comunque', async () => {
    const { service, llmConfig } = build({
      activeModel: 'modello-rimosso',
      tier: 'go',
      working: ['deepseek-v4-flash'],
    });
    await service.getOpencodeModels();
    expect(llmConfig.setOpencodeModel).toHaveBeenCalledWith(null, 'deepseek-v4-flash');
  });

  it('non tocca niente se il modello attivo funziona', async () => {
    const { service, llmConfig, notifications } = build({
      activeModel: 'deepseek-v4-flash',
      tier: 'go',
      working: ['deepseek-v4-flash'],
      broken: ['gpt-5.6-luna'],
    });
    await service.getOpencodeModels();
    expect(llmConfig.setOpencodeModel).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('non tocca niente se nessun modello funziona: meglio un modello rotto che nessuno', async () => {
    const { service, llmConfig, notifications } = build({
      activeModel: 'muse-spark-1.3-contributor',
      tier: 'go',
      working: [],
      broken: ['muse-spark-1.3-contributor'],
    });
    await service.getOpencodeModels();
    expect(llmConfig.setOpencodeModel).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('non tocca niente se si sta guardando una tier diversa da quella configurata', async () => {
    // La pagina può chiedere `?tier=zen` per curiosità: la configurazione è Go
    // e non va riscritta in base a una lista che non la riguarda.
    const { service, llmConfig } = build({
      activeModel: 'deepseek-v4-flash',
      tier: 'go',
      working: ['claude-sonnet-5'],
      broken: ['deepseek-v4-flash'],
    });
    await service.getOpencodeModels('zen');
    expect(llmConfig.setOpencodeModel).not.toHaveBeenCalled();
  });

  it('non tocca niente se il provider attivo è Ollama', async () => {
    const { service, llmConfig } = build({
      activeModel: 'qwen2.5:7b',
      tier: 'go',
      working: ['deepseek-v4-flash'],
      provider: 'ollama',
    });
    await service.getOpencodeModels();
    expect(llmConfig.setOpencodeModel).not.toHaveBeenCalled();
  });

  it('senza API key elenca senza verificare, invece di mostrare una lista vuota', async () => {
    const { service, availability } = build({
      activeModel: 'deepseek-v4-flash',
      tier: 'go',
      working: ['deepseek-v4-flash', 'kimi-k3'],
      key: '',
    });
    const res = await service.getOpencodeModels();
    expect(availability.get).not.toHaveBeenCalled();
    expect(res.models.map((m) => m.modelId)).toEqual(['deepseek-v4-flash', 'kimi-k3']);
    expect(res.checkedAt).toBeNull();
    expect(res.excludedCount).toBe(0);
  });
});
