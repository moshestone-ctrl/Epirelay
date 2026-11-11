import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F4F1',
  card: '#FFFFFF',
  cardAlt: '#EFECE7',
  text: '#17171A',
  muted: '#5F5E66',
  border: '#E2DED7',
  danger: '#D21F3C',
  dangerSoft: '#FDE8EB',
  onDanger: '#FFFFFF',
  ok: '#16794A',
  okSoft: '#E3F4EA',
  warn: '#A15C07',
  warnSoft: '#FDF1DC',
  accent: '#1D4ED8',
  onAccent: '#FFFFFF',
  input: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#111113',
  card: '#1C1C20',
  cardAlt: '#26262B',
  text: '#F3F2F0',
  muted: '#A3A2AA',
  border: '#2F2F35',
  danger: '#F0384F',
  dangerSoft: '#3A1419',
  onDanger: '#FFFFFF',
  ok: '#3BBF7E',
  okSoft: '#13291D',
  warn: '#F0A445',
  warnSoft: '#33240F',
  accent: '#6E9BFF',
  onAccent: '#0B1020',
  input: '#17171A',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 };
export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
