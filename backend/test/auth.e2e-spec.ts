import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Test e2e dell'happy path di autenticazione.
 * Richiede che il database sia accessibile (esegui migrate prima del test).
 *
 *   docker compose exec backend npm run prisma:migrate:deploy
 *   docker compose exec backend npm run test:e2e
 *
 * Il test crea il proprio admin di test e lo ripulisce alla fine.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Crea utente di test direttamente con argon2 (bypass invito)
    const argon2 = await import('argon2');
    await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await argon2.hash(testPassword, { type: argon2.argon2id }),
        role: 'admin',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await app.close();
  });

  it('rejects /users/me without auth', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('rejects login with wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: 'wrong' })
      .expect(401);
  });

  it('logs in, fetches /users/me, refreshes, logs out', async () => {
    const agent = request.agent(app.getHttpServer());

    const login = await agent
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);
    expect(login.body.userId).toBeDefined();
    expect(login.body.role).toBe('admin');

    const me = await agent.get('/users/me').expect(200);
    expect(me.body.email).toBe(testEmail);

    await agent.post('/auth/refresh').expect(200);

    // Dopo refresh i nuovi cookie sono validi
    await agent.get('/users/me').expect(200);

    await agent.post('/auth/logout').expect(204);

    // Cookie eliminati: 401
    await agent.get('/users/me').expect(401);
  });

  it('admin can create invites; non-admin cannot', async () => {
    const adminAgent = request.agent(app.getHttpServer());
    await adminAgent
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const invite = await adminAgent
      .post('/auth/invite')
      .send({ email: `invitee-${Date.now()}@example.com` })
      .expect(201);
    expect(invite.body.inviteUrl).toContain('/accept-invite?token=');
  });
});
