// Servicio de notificaciones (Cloudflare Worker, ver docs/NOTIFICACIONES.md). Nada de esto es secreto:
// la dirección del Worker y la llave pública VAPID. La llave privada vive solo en Cloudflare.
export const PUSH = {
  url: '',        // ej.: 'https://futari-push.<tu-cuenta>.workers.dev'
  publicKey: '',  // VAPID_PUBLIC_KEY (la misma que en Cloudflare)
};
