import {
  AVAILABILITY_TTL_MS,
  OpencodeAvailabilityService,
  PROBE_CONCURRENCY,
} from './opencode-availability.service';
import type { OpencodeClient } from './opencode.client';

/**
 * La foto di "quali modelli funzionano adesso" deve costare poco: una passata
 * sola anche con dieci richieste insieme, niente risonde entro il TTL, e
 * l'apertura della pagina non aspetta mai un rinfresco (serve la foto vecchia
 * e aggiorna dietro le quinte).
 */
describe('OpencodeAvailabilityService', () => {
  let listed: string[];
  let broken: Set<string>;
  let client: { listModels: jest.Mock; probeModel: jest.Mock };
  let service: OpencodeAvailabilityService;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-09-10T10:00:00Z'));
    listed = ['alfa', 'beta', 'gamma'];
    broken = new Set(['beta']);
    client = {
      listModels: jest.fn(async () => [...listed]),
      probeModel: jest.fn(async (_tier: unknown, _key: unknown, model: string) =>
        broken.has(model)
          ? { ok: false, status: 500, detail: 'Internal server error' }
          : { ok: true },
      ),
    };
    service = new OpencodeAvailabilityService(client as unknown as OpencodeClient);
  });

  afterEach(() => jest.useRealTimers());

  it('alla prima chiamata sonda tutti i modelli elencati', async () => {
    const { snapshot, refreshing } = await service.get('go', 'sk-x');
    expect(refreshing).toBe(false);
    expect(client.probeModel).toHaveBeenCalledTimes(3);
    expect(snapshot.models.filter((m) => m.ok).map((m) => m.modelId)).toEqual(['alfa', 'gamma']);
    const rotto = snapshot.models.find((m) => m.modelId === 'beta');
    expect(rotto).toMatchObject({ ok: false, status: 500 });
  });

  it('entro il TTL non risonda niente', async () => {
    await service.get('go', 'sk-x');
    client.probeModel.mockClear();
    jest.setSystemTime(new Date(Date.now() + AVAILABILITY_TTL_MS - 1000));
    const { refreshing } = await service.get('go', 'sk-x');
    expect(refreshing).toBe(false);
    expect(client.probeModel).not.toHaveBeenCalled();
  });

  it('oltre il TTL risponde subito con la foto vecchia e rinfresca in background', async () => {
    const primo = await service.get('go', 'sk-x');
    jest.setSystemTime(new Date(Date.now() + AVAILABILITY_TTL_MS + 1000));

    // Nel frattempo il gateway ha guarito beta e aggiunto delta.
    broken.clear();
    listed.push('delta');

    const secondo = await service.get('go', 'sk-x');
    expect(secondo.refreshing).toBe(true);
    // Risposta immediata: è ancora la foto di prima, non aspetta la passata.
    expect(secondo.snapshot.checkedAt).toEqual(primo.snapshot.checkedAt);

    await service.whenIdle();
    const terzo = await service.get('go', 'sk-x');
    expect(terzo.refreshing).toBe(false);
    expect(terzo.snapshot.models.filter((m) => m.ok).map((m) => m.modelId)).toEqual([
      'alfa',
      'beta',
      'delta',
      'gamma',
    ]);
  });

  it('dieci richieste insieme fanno una passata sola', async () => {
    await Promise.all(Array.from({ length: 10 }, () => service.get('go', 'sk-x')));
    expect(client.listModels).toHaveBeenCalledTimes(1);
    expect(client.probeModel).toHaveBeenCalledTimes(3);
  });

  it('non sonda più di PROBE_CONCURRENCY modelli insieme', async () => {
    listed = Array.from({ length: 30 }, (_, i) => `m${i}`);
    let inVolo = 0;
    let massimo = 0;
    client.probeModel.mockImplementation(async () => {
      inVolo++;
      massimo = Math.max(massimo, inVolo);
      await new Promise((r) => setTimeout(r, 5));
      inVolo--;
      return { ok: true };
    });
    await service.get('go', 'sk-x');
    expect(massimo).toBeLessThanOrEqual(PROBE_CONCURRENCY);
    expect(client.probeModel).toHaveBeenCalledTimes(30);
  });

  it('invalidate() butta la foto: la chiave o la tier sono cambiate', async () => {
    await service.get('go', 'sk-x');
    service.invalidate();
    client.probeModel.mockClear();
    await service.get('go', 'sk-x');
    expect(client.probeModel).toHaveBeenCalledTimes(3);
  });

  it('tiene foto separate per tier', async () => {
    await service.get('go', 'sk-x');
    client.listModels.mockClear();
    await service.get('zen', 'sk-x');
    expect(client.listModels).toHaveBeenCalledWith('zen');
  });
});
