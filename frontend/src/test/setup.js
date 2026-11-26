import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest globals are off, so RTL's automatic cleanup does not register itself.
afterEach(() => cleanup());
