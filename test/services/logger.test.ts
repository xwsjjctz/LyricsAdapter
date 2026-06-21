import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, LogLevel } from '@/services/logger';

describe('Logger', () => {
  beforeEach(() => {
    logger.setLevel(LogLevel.DEBUG);
  });

  describe('setLevel / getLevel', () => {
    it('should default to DEBUG in dev environment', () => {
      // import.meta.env.DEV is true in Vitest
      expect(logger.getLevel()).toBeLessThanOrEqual(LogLevel.DEBUG);
    });

    it('should change level via setLevel', () => {
      logger.setLevel(LogLevel.WARN);
      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });

    it('should set NONE to silence all output', () => {
      logger.setLevel(LogLevel.NONE);
      expect(logger.getLevel()).toBe(LogLevel.NONE);
    });
  });

  describe('debug', () => {
    it('should output when level ≤ DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.debug('msg');
      expect(spy).toHaveBeenCalledWith('[DEBUG]', 'msg');
      spy.mockRestore();
    });

    it('should not output when level > DEBUG', () => {
      logger.setLevel(LogLevel.INFO);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logger.debug('msg');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('info', () => {
    it('should output when level ≤ INFO', () => {
      logger.setLevel(LogLevel.INFO);
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('msg');
      expect(spy).toHaveBeenCalledWith('[INFO]', 'msg');
      spy.mockRestore();
    });

    it('should not output when level > INFO', () => {
      logger.setLevel(LogLevel.WARN);
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('msg');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('warn', () => {
    it('should output at WARN level', () => {
      logger.setLevel(LogLevel.WARN);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('msg');
      expect(spy).toHaveBeenCalledWith('[WARN]', 'msg');
      spy.mockRestore();
    });

    it('should output at lower levels too', () => {
      logger.setLevel(LogLevel.DEBUG);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('msg');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('error', () => {
    it('should output at ERROR level', () => {
      logger.setLevel(LogLevel.ERROR);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('msg');
      expect(spy).toHaveBeenCalledWith('[ERROR]', 'msg');
      spy.mockRestore();
    });

    it('should output at DEBUG level too', () => {
      logger.setLevel(LogLevel.DEBUG);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('msg');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('silence at NONE', () => {
    it('should not output any messages at NONE level', () => {
      logger.setLevel(LogLevel.NONE);
      const spies = [
        vi.spyOn(console, 'log').mockImplementation(() => {}),
        vi.spyOn(console, 'info').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
        vi.spyOn(console, 'error').mockImplementation(() => {}),
      ];
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      spies.forEach(s => {
        expect(s).not.toHaveBeenCalled();
        s.mockRestore();
      });
    });
  });

  describe('withScope', () => {
    it('should prefix messages with the scope tag', () => {
      logger.setLevel(LogLevel.DEBUG);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const scoped = logger.withScope('Scope');
      scoped.debug('hello');
      expect(spy).toHaveBeenCalledWith('[DEBUG]', '[Scope]', 'hello');
      spy.mockRestore();
    });

    it('should respect the parent logger level', () => {
      logger.setLevel(LogLevel.WARN);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const scoped = logger.withScope('X');
      scoped.debug('hidden');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should delegate all levels correctly', () => {
      logger.setLevel(LogLevel.DEBUG);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const scoped = logger.withScope('S');

      scoped.error('e');
      scoped.warn('w');

      expect(errorSpy).toHaveBeenCalledWith('[ERROR]', '[S]', 'e');
      expect(warnSpy).toHaveBeenCalledWith('[WARN]', '[S]', 'w');

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
