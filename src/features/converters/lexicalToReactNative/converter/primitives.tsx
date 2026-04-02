import React from 'react'

import type { ReactNativePrimitiveOverrides, ReactNativePrimitives } from './types.js'
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native'

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

export const defaultReactNativePrimitives: ReactNativePrimitives = {
  Image: Image ?? FallbackImage,
  Pressable: Pressable ?? FallbackPressable,
  ScrollView: ScrollView ?? FallbackScrollView,
  Text: Text ?? FallbackText,
  View: View ?? FallbackView,
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
  const openURL = Linking?.openURL

  if (typeof openURL === 'function') {
    Promise.resolve(openURL(url)).catch(() => {
      // Do not throw from renderer event handlers.
    })
  }
}
