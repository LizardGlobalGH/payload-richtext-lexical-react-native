import React from 'react'

import type { ReactNativePrimitiveOverrides, ReactNativePrimitives } from './types.js'

type ReactNativeRuntime = {
  Image?: React.ComponentType<Record<string, unknown>>
  Linking?: {
    openURL?: (url: string) => Promise<unknown> | void
  }
  Pressable?: React.ComponentType<Record<string, unknown>>
  ScrollView?: React.ComponentType<Record<string, unknown>>
  Text?: React.ComponentType<Record<string, unknown>>
  View?: React.ComponentType<Record<string, unknown>>
}

const FallbackView: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>
}

const FallbackText: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>
}

const FallbackPressable: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>
}

const FallbackScrollView: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>
}

const FallbackImage: React.FC = () => {
  return null
}

const loadReactNativeRuntime = (): ReactNativeRuntime => {
  const possibleRequire = (globalThis as { require?: (specifier: string) => unknown }).require

  if (typeof possibleRequire !== 'function') {
    return {}
  }

  try {
    return (possibleRequire('react-native') as ReactNativeRuntime) ?? {}
  } catch {
    return {}
  }
}

const reactNativeRuntime = loadReactNativeRuntime()

export const defaultReactNativePrimitives: ReactNativePrimitives = {
  Image: reactNativeRuntime.Image ?? FallbackImage,
  Pressable: reactNativeRuntime.Pressable ?? FallbackPressable,
  ScrollView: reactNativeRuntime.ScrollView ?? FallbackScrollView,
  Text: reactNativeRuntime.Text ?? FallbackText,
  View: reactNativeRuntime.View ?? FallbackView,
}

export const resolveReactNativePrimitives = (
  overrides?: ReactNativePrimitiveOverrides,
): ReactNativePrimitives => {
  return {
    ...defaultReactNativePrimitives,
    ...overrides,
  }
}

export const openExternalURL = (url: string): void => {
  const openURL = reactNativeRuntime.Linking?.openURL

  if (typeof openURL === 'function') {
    Promise.resolve(openURL(url)).catch(() => {
      // Do not throw from renderer event handlers.
    })
  }
}
