export interface AppNotificationOptions {
  silent?: boolean;
  /** Ordered artwork candidates. The first image is the primary track cover. */
  artworkUrls?: string[];
}

export interface AppNotificationPayload extends AppNotificationOptions {
  title: string;
  body: string;
}
