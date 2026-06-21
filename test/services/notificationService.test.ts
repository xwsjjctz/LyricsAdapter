import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { notify } from '@/services/notificationService';

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notify', () => {
  it('should use Electron API when available', async () => {
    const showNotification = vi.fn();
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue({
      showNotification,
    });

    await notify('Title', 'Body');
    expect(showNotification).toHaveBeenCalledWith('Title', 'Body', undefined);
  });

  it('should pass options to Electron notification', async () => {
    const showNotification = vi.fn();
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue({
      showNotification,
    });

    await notify('Title', 'Body', { silent: true });
    expect(showNotification).toHaveBeenCalledWith('Title', 'Body', { silent: true });
  });

  it('should create Web Notification when no Electron API', async () => {
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const NotificationMock = vi.fn().mockImplementation(() => {});
    (NotificationMock as any).permission = 'granted';
    const origNotification = globalThis.Notification;
    (globalThis as any).Notification = NotificationMock;

    await notify('Web Title', 'Web Body');

    expect(NotificationMock).toHaveBeenCalledWith('Web Title', { body: 'Web Body' });
    (globalThis as any).Notification = origNotification;
  });

  it('should pass silent option to Web Notification', async () => {
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const NotificationMock = vi.fn().mockImplementation(() => {});
    (NotificationMock as any).permission = 'granted';
    const origNotification = globalThis.Notification;
    (globalThis as any).Notification = NotificationMock;

    await notify('Title', 'Body', { silent: true });
    expect(NotificationMock).toHaveBeenCalledWith('Title', { body: 'Body', silent: true });
    (globalThis as any).Notification = origNotification;
  });

  it('should handle Notification API not available gracefully', async () => {
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const origNotification = globalThis.Notification;
    (globalThis as any).Notification = undefined;

    await expect(notify('Title', 'Body')).resolves.toBeUndefined();

    (globalThis as any).Notification = origNotification;
  });

  it('should handle errors gracefully without throwing', async () => {
    (getDesktopAPI as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const NotificationMock = vi.fn().mockImplementation(() => {
      throw new Error('mock error');
    });
    (NotificationMock as any).permission = 'granted';
    const origNotification = globalThis.Notification;
    (globalThis as any).Notification = NotificationMock;

    await expect(notify('Title', 'Body')).resolves.toBeUndefined();

    (globalThis as any).Notification = origNotification;
  });
});
