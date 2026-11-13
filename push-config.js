// Servicio de notificaciones (Cloudflare Worker, ver docs/NOTIFICACIONES.md). Nada de esto es secreto:
// la dirección del Worker y la llave pública VAPID. La llave privada vive solo en Cloudflare.
export const PUSH = {
  url: 'https://futari-push.sebas-chavese17.workers.dev',
  publicKey: 'BFOT8o7WtX6QOGhesGEjuskE5gjTZSYqVImau-zevnsM7ZIY4GOao8igE0Pqo69VQl0YX4-6mAsUDIyCzXb_CTI', // VAPID_PUBLIC_KEY (la misma que en Cloudflare)
};
