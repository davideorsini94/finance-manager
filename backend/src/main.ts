import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { normalizePsuIp, runWithPsuContext } from './common/utils/psu-context';

// Permette a JSON.stringify di serializzare BigInt come stringa.
// Prisma usa BigInt per amountCents/balanceCents per evitare overflow su importi grandi.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // Dietro nginx: rispetta X-Forwarded-Proto/Host per generare URL invito corretti
  app.set('trust proxy', true);

  app.use(cookieParser());

  // Ogni richiesta HTTP ha per definizione un utente online: apriamo il
  // contesto PSU, che `EnableBankingClient` traduce negli header con cui la
  // banca distingue un accesso presidiato da un fetch di sottofondo (limitato
  // a 4/giorno). I cron girano fuori da qui e restano non presidiati.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    runWithPsuContext(
      { ipAddress: normalizePsuIp(req.ip), userAgent: req.get('user-agent') ?? null },
      next,
    );
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.setGlobalPrefix('', { exclude: [] });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend listening on :${port}`);
}

bootstrap();
