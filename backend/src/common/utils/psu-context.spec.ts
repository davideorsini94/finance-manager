import { getPsuContext, normalizePsuIp, psuHeaders, runWithPsuContext } from './psu-context';

/**
 * Il contesto PSU decide se una chiamata alla banca vale come "utente online"
 * (limiti PSD2 larghi) o come fetch di sottofondo (tetto di 4 accessi al
 * giorno). Sbagliare in un senso fa fallire i collegamenti con un 429, nell'
 * altro dichiara presente un utente che non c'è: entrambi i versi sono
 * coperti dai test.
 */
describe('psu-context', () => {
  describe('normalizePsuIp', () => {
    it('accetta un IPv4 pubblico', () => {
      expect(normalizePsuIp('93.44.12.7')).toBe('93.44.12.7');
    });

    it('srotola gli IPv4 mappati in IPv6 (forma tipica dietro proxy)', () => {
      expect(normalizePsuIp('::ffff:93.44.12.7')).toBe('93.44.12.7');
    });

    it('accetta un IPv6', () => {
      expect(normalizePsuIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('scarta loopback e valori inutilizzabili', () => {
      // Un IP di loopback non descrive nessun utente reale: mandarlo alla
      // banca dichiara "utente online" con un dato falso.
      expect(normalizePsuIp('127.0.0.1')).toBeNull();
      expect(normalizePsuIp('::1')).toBeNull();
      expect(normalizePsuIp('')).toBeNull();
      expect(normalizePsuIp(undefined)).toBeNull();
      expect(normalizePsuIp('non-un-ip')).toBeNull();
    });
  });

  describe('psuHeaders', () => {
    it('è vuoto fuori da una richiesta HTTP (cron: fetch di sottofondo)', () => {
      expect(getPsuContext()).toBeUndefined();
      expect(psuHeaders()).toEqual({});
    });

    it('espone IP e user agent quando l’utente è online', () => {
      runWithPsuContext({ ipAddress: '93.44.12.7', userAgent: 'Mozilla/5.0 (iPhone)' }, () => {
        expect(psuHeaders()).toEqual({
          'Psu-Ip-Address': '93.44.12.7',
          'Psu-User-Agent': 'Mozilla/5.0 (iPhone)',
        });
      });
    });

    it('omette gli header assenti invece di inviarli vuoti', () => {
      runWithPsuContext({ ipAddress: null, userAgent: 'Mozilla/5.0' }, () => {
        expect(psuHeaders()).toEqual({ 'Psu-User-Agent': 'Mozilla/5.0' });
      });
      runWithPsuContext({ ipAddress: '93.44.12.7', userAgent: null }, () => {
        expect(psuHeaders()).toEqual({ 'Psu-Ip-Address': '93.44.12.7' });
      });
    });

    it('sopravvive ai confini asincroni (il sync automatico parte dopo la risposta)', async () => {
      await runWithPsuContext({ ipAddress: '93.44.12.7', userAgent: 'UA' }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        expect(psuHeaders()).toEqual({
          'Psu-Ip-Address': '93.44.12.7',
          'Psu-User-Agent': 'UA',
        });
      });
    });

    it('non perde il contesto tra richieste concorrenti', async () => {
      const [a, b] = await Promise.all([
        runWithPsuContext({ ipAddress: '10.0.0.1', userAgent: 'A' }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return psuHeaders();
        }),
        runWithPsuContext({ ipAddress: '10.0.0.2', userAgent: 'B' }, async () => {
          return psuHeaders();
        }),
      ]);
      expect(a['Psu-Ip-Address']).toBe('10.0.0.1');
      expect(b['Psu-Ip-Address']).toBe('10.0.0.2');
    });

    it('tronca uno user agent abnorme invece di inoltrarlo così com’è', () => {
      runWithPsuContext({ ipAddress: null, userAgent: 'x'.repeat(500) }, () => {
        expect(psuHeaders()['Psu-User-Agent']!.length).toBeLessThanOrEqual(200);
      });
    });
  });
});
