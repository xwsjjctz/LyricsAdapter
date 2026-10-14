import { BrowserWindow, dialog } from 'electron';
import type { PluginUpdateSource } from '../../src/shared/pluginUpdate';
import { mainTranslator } from './mainI18n';
import type { PluginTrustRequest } from './pluginUpdates';

/** Human-readable origin the user is asked to trust. */
export function describePluginSource(source: PluginUpdateSource): string {
  if (source.kind === 'github') return `https://github.com/${source.repository} (${source.channel})`;
  if (source.kind === 'manifest') return `${source.url} (${source.channel})`;
  return 'LyricsAdapter-Music-Plugins';
}

/**
 * Native confirmation shown by the main process, so a compromised renderer
 * cannot approve third-party code on the user's behalf. Cancel is the default.
 */
export async function confirmPluginTrust(request: PluginTrustRequest): Promise<boolean> {
  const t = mainTranslator();
  const source = describePluginSource(request.source);
  const update = request.kind === 'update';
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: t(update ? 'pluginTrust.updateTitle' : 'pluginTrust.bindTitle'),
    message: t(update ? 'pluginTrust.updateMessage' : 'pluginTrust.bindMessage', { name: request.name }),
    detail: update
      ? t('pluginTrust.updateDetail', { source, current: request.currentVersion, next: request.targetVersion, sha256: request.sha256 })
      : t('pluginTrust.bindDetail', { source }),
    buttons: [t('pluginTrust.cancel'), t(update ? 'pluginTrust.confirmUpdate' : 'pluginTrust.confirmBind')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return response === 1;
}
