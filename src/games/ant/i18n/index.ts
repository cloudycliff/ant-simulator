import { registerDicts } from '../../../core/i18n';
import { en } from './en';
import { zh } from './zh';

declare module '../../../core/i18n' {
  interface Messages extends Record<keyof typeof zh, true> {}
}

registerDicts({ zh, en });
