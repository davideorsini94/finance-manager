// Entrambi i token (access + refresh) vivono in cookie httpOnly gestiti
// interamente dal backend, perciò il frontend non li tocca.
//
// Il client HTTP usa `credentials: 'include'` per inviarli automaticamente
// e questo modulo è volutamente vuoto: lo teniamo come placeholder per
// eventuali future modifiche (es. CSRF token in memoria).
export {};
