import type { FocusGlassPresentation } from './focusGlass';

export type LibraryToolbarGlassSymbol =
  | 'edit'
  | 'check'
  | 'refresh'
  | 'upload-file'
  | 'cloud-upload';

export interface LibraryToolbarGlassButtonState {
  presentation: FocusGlassPresentation;
  symbol: LibraryToolbarGlassSymbol;
  enabled: boolean;
  emphasized: boolean;
  tintColor: string;
  label: string;
}

export interface LibraryToolbarGlassState {
  darkMode: boolean;
  primary: LibraryToolbarGlassButtonState;
  secondary: LibraryToolbarGlassButtonState;
}

export type LibraryToolbarGlassAction = {
  type: 'primary' | 'secondary' | 'primary-hover';
  value: number;
};
