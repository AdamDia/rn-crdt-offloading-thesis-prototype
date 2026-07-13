/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

import {beforeAll, it, jest} from '@jest/globals';

import renderer, {act} from 'react-test-renderer';

beforeAll(() => {
  const globalWithWindow = global as typeof globalThis & {
    window?: {dispatchEvent?: jest.Mock};
  };

  Object.defineProperty(global, 'window', {
    value: globalWithWindow.window ?? {},
    writable: true,
    configurable: true,
  });

  globalWithWindow.window!.dispatchEvent = jest.fn();
});

it('renders correctly', () => {
  act(() => {
    renderer.create(<App />);
  });
});
