import type { SettingsSectionId } from './settingsPanel';

/** Text colour roles; AppKit maps them to its label colours. */
export type NativeSettingsTone = 'default' | 'secondary' | 'muted' | 'accent' | 'success' | 'error';

export type NativeSettingsControl =
  /** Read-only value beside a row's title, e.g. the app version. */
  | { type: 'label'; text: string; tone: NativeSettingsTone }
  /** `symbol` is an SF Symbol shown before the title; an empty title makes an icon button named by `label`. */
  | { type: 'button'; id: string; title: string; symbol: string; style: 'primary' | 'secondary' | 'plain' | 'destructive'; enabled: boolean; label: string }
  /** Opens an https URL in the browser. */
  | { type: 'link'; id: string; title: string; url: string }
  /** Shows or hides the rows that follow it, like the web card's "Settings" toggle. */
  | { type: 'disclosure'; id: string; title: string; expanded: boolean; label: string }
  | { type: 'switch'; id: string; on: boolean; enabled: boolean; label: string }
  | { type: 'popup'; id: string; value: string; options: { value: string; title: string }[]; enabled: boolean; label: string }
  | { type: 'slider'; id: string; value: number; min: number; max: number; step: number; display: string; label: string }
  /**
   * Text input. AppKit owns the text while it is being edited and reports every change;
   * a new `revision` replaces the text even then (a saved secret is cleared, for example).
   */
  | { type: 'field'; id: string; value: string; revision: number; placeholder: string; secure: boolean; lines: number; enabled: boolean; label: string }
  /** A shortcut binding; while `recording`, the control takes the keyboard and reports keys. */
  | { type: 'shortcut'; id: string; display: string; state: 'default' | 'custom' | 'unset'; recording: boolean; prompt: string; label: string }
  /** PNG data URL, e.g. a sign-in QR code, drawn `size` points square. */
  | { type: 'image'; id: string; source: string; size: number; label: string }
  | { type: 'spinner' };

export interface NativeSettingsRow {
  id: string;
  /**
   * inline: title and detail on the left, controls on the right (on their own, controls sit right).
   * stacked: title above, controls below at full width (text fields).
   * message: a result line with a success or error mark. note: wrapping text only.
   * subheading: a bold title inside a card. center: controls centred (a QR code).
   * actions: controls only, from the leading edge.
   */
  layout: 'inline' | 'stacked' | 'message' | 'note' | 'subheading' | 'center' | 'actions';
  title: string;
  detail: string;
  /** Text under the controls, e.g. a field's hint. */
  footnote: string;
  /** Colour of the title (the only text of message, note and subheading rows). */
  tone: NativeSettingsTone;
  detailTone: NativeSettingsTone;
  controls: NativeSettingsControl[];
}

export interface NativeSettingsBlock {
  id: string;
  /** card: rows on a rounded background with separators; plain: rows directly on the sheet. */
  kind: 'card' | 'plain';
  heading: string;
  headingControls: NativeSettingsControl[];
  rows: NativeSettingsRow[];
}

export interface NativeSettingsSection {
  id: SettingsSectionId;
  /** Heading in the list. */
  title: string;
  /** Short label in the navigation bar. */
  navTitle: string;
  /** SF Symbol of the navigation item. */
  symbol: string;
  /** A credential draft in this section is waiting to be saved. */
  unsaved: boolean;
  blocks: NativeSettingsBlock[];
}

/** A confirmation shown over the sheet; a failed confirmation keeps it open with `error`. */
export interface NativeSettingsDialog {
  title: string;
  message: string;
  error: string;
  confirmTitle: string;
  cancelTitle: string;
  destructive: boolean;
  busy: boolean;
}

export interface NativeSettingsState {
  open: boolean;
  darkMode: boolean;
  title: string;
  closeLabel: string;
  unsavedLabel: string;
  /** The list scrolls to `section` whenever `token` changes. */
  reveal: { section: SettingsSectionId; token: number };
  sections: NativeSettingsSection[];
  dialog: NativeSettingsDialog | null;
}

export type NativeSettingsActionType =
  | 'close'         // close button or Escape
  | 'visible'       // id: a section scrolled into view
  | 'button'        // id
  | 'disclosure'    // id
  | 'switch'        // id; value: 1 on, 0 off
  | 'popup'         // id; text: chosen value
  | 'slider'        // id; value
  | 'field'         // id; text: contents after an edit (never mid-composition)
  | 'commit'        // id; text: contents when editing ends or Enter is pressed
  | 'record'        // id: a shortcut control was clicked to record
  | 'record-key'    // id; text: DOM key; code: DOM code; value: modifier bits
  | 'record-cancel' // id: the recorder lost the keyboard
  | 'dialog'        // text: 'confirm' | 'cancel'
  | 'shortcut';     // text: DOM key; value: modifier bits — an app shortcut pressed in the sheet

export interface NativeSettingsAction {
  type: NativeSettingsActionType;
  id: string;
  value: number;
  text: string;
  code: string;
}

export const NATIVE_SETTINGS_MODIFIERS = { meta: 1, ctrl: 2, alt: 4, shift: 8 } as const;

/** Limits shared by the snapshot builder and the main-process schema. */
export const NATIVE_SETTINGS_LIMITS = {
  sections: 8,
  blocks: 96,
  rows: 160,
  controls: 6,
  options: 64,
  text: 4096,
  field: 16384,
  image: 512 * 1024,
} as const;
