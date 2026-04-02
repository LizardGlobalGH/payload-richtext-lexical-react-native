# Payload Lexical Rich Text Editor

Lexical Rich Text Editor for [Payload](https://payloadcms.com).

- [Main Repository](https://github.com/payloadcms/payload)
- [Payload Docs](https://payloadcms.com/docs)

## Installation

```bash
npm install @payloadcms/richtext-lexical
```

## Usage

```ts
import { buildConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

export default buildConfig({
  editor: lexicalEditor({}),
  // ...rest of config
})
```

More detailed usage can be found in the [Payload Docs](https://payloadcms.com/docs/configuration/overview).

## React Native Renderer

This package also ships a renderer-only React Native entrypoint:

```ts
import { RichText } from '@payloadcms/richtext-lexical/react-native'
```

This is intended for rendering serialized Lexical content in React Native or Expo apps. It does not include editor functionality.

### Basic Usage

```tsx
import { RichText } from '@payloadcms/richtext-lexical/react-native'

export function ArticleBody({ data }: { data: any }) {
  return <RichText data={data} />
}
```

### Simple Reproducible Example

The example below is intentionally minimal and can be pasted into a new Expo screen.
It demonstrates the smallest useful setup with:

- Serialized Lexical input
- The React Native `RichText` renderer
- External link handling

```tsx
import * as Linking from 'expo-linking'
import { SafeAreaView, ScrollView } from 'react-native'
import { RichText } from '@payloadcms/richtext-lexical/react-native'

const sampleLexical = {
  root: {
    children: [
      {
        type: 'heading',
        tag: 'h2',
        version: 1,
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'Hello from Payload',
            type: 'text',
            version: 1,
          },
        ],
      },
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: 'Read the docs at ',
            type: 'text',
            version: 1,
          },
          {
            type: 'link',
            fields: { linkType: 'custom', newTab: true, url: 'https://payloadcms.com/docs' },
            format: '',
            indent: 0,
            version: 3,
            children: [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'payloadcms.com/docs',
                type: 'text',
                version: 1,
              },
            ],
          },
          { detail: 0, format: 0, mode: 'normal', style: '', text: '.', type: 'text', version: 1 },
        ],
      },
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
}

export default function ExampleScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <RichText
          data={sampleLexical}
          onExternalLinkPress={({ url }) => {
            void Linking.openURL(url)
          }}
        />
      </ScrollView>
    </SafeAreaView>
  )
}
```

If you can render this screen and tap the link successfully, your baseline integration is working.

### Primitive Overrides

The React Native renderer can replace the primitives it uses internally. This is useful when your app wraps base components for theming, analytics, navigation, or design system integration.

If a primitive override is omitted, the renderer falls back to its default primitive.

```tsx
import { Pressable, Text, View } from '@/components/ui'
import { RichText } from '@payloadcms/richtext-lexical/react-native'

export function ArticleBody({ data }: { data: any }) {
  return (
    <RichText
      data={data}
      primitives={{
        Pressable,
        Text,
        View,
      }}
    />
  )
}
```

Supported primitive keys:

- `Text`
- `View`
- `Pressable`
- `Image`
- `ScrollView`

### Custom Converters

Like the React renderer, the React Native renderer supports converter overrides.

```tsx
import { RichText } from '@payloadcms/richtext-lexical/react-native'

export function ArticleBody({ data }: { data: any }) {
  return (
    <RichText
      converters={({ defaultConverters, primitives }) => ({
        ...defaultConverters,
        heading: ({ node, nodesToReactNative }) => {
          const TextPrimitive = primitives.Text

          return (
            <TextPrimitive style={{ fontSize: node.tag === 'h1' ? 36 : 28, fontWeight: '700' }}>
              {nodesToReactNative({ nodes: node.children })}
            </TextPrimitive>
          )
        },
      })}
      data={data}
    />
  )
}
```

The `converters` prop accepts either:

- An object of converters
- A function that receives `defaultConverters` and resolved `primitives`

### Link Handling

The default React Native link converter supports external links.

```tsx
import * as Linking from 'expo-linking'
import { RichText } from '@payloadcms/richtext-lexical/react-native'

export function ArticleBody({ data }: { data: any }) {
  return (
    <RichText
      data={data}
      onExternalLinkPress={({ url }) => {
        void Linking.openURL(url)
      }}
    />
  )
}
```

Current default behavior:

- External links are supported.
- Internal links are not resolved by default.
- If `onExternalLinkPress` is not provided, the renderer attempts to open the URL through the React Native runtime when available.

### Upload Handling

The default upload converter supports a single image URL or a file link.

Current default behavior:

- Images render through the resolved `Image` primitive.
- Non-image uploads render as a pressable file link.
- Responsive web-only picture behavior is intentionally not implemented in the React Native renderer.

## Technical Implementation

The React Native renderer follows the same general architecture as the existing React renderer.

### Why This Architecture

The renderer is converter-driven by design.

- Lexical JSON is a tree of node types, so mapping node type -> converter keeps behavior explicit.
- Converters are pure rendering units, which makes customization local and predictable.
- Primitive injection avoids hard-coding React Native imports in every converter, enabling design-system compatibility.
- Sharing the conceptual model with the React renderer reduces maintenance overhead and cognitive load when moving between platforms.

This approach favors extension points over hidden behavior: if a node needs different rendering, you override its converter.

### Public API

The public entrypoint is exported from `@payloadcms/richtext-lexical/react-native` and includes:

- `RichText`
- `convertLexicalToReactNative`
- `convertLexicalNodesToReactNative`
- `defaultReactNativeConverters`
- Primitive utilities and converter types

Expected use of each export:

- `RichText`: primary API for app usage. Prefer this unless you need custom orchestration.
- `convertLexicalToReactNative`: converts a full serialized editor state to React Native nodes.
- `convertLexicalNodesToReactNative`: lower-level helper for converting a specific node array.
- `defaultReactNativeConverters`: base converter map for extension/override patterns.
- Primitive utilities and converter types: typing + primitive resolution helpers for custom integrations.

### Conversion Pipeline

The renderer converts serialized Lexical nodes through a converter map.

1. `RichText` resolves primitive overrides and converter overrides.
2. `convertLexicalToReactNative` starts at the editor state root.
3. `convertLexicalNodesToReactNative` walks child nodes recursively.
4. Each node is matched to a converter by node type.
5. Converters return React elements built from resolved primitives.

This structure keeps the renderer extensible while preserving predictable defaults.

In practice, this means there is a single place where behavior is chosen for each node type, which simplifies debugging and makes output differences easier to reason about.

### Expected Usage Flow

For most applications, the intended flow is:

1. Fetch document data from Payload.
2. Pass the serialized Lexical JSON to `RichText`.
3. Provide `onExternalLinkPress` to control URL opening behavior.
4. Optionally provide primitive overrides for app-wide UI consistency.
5. Add converter overrides only for node-specific presentation or behavior.

Suggested progression:

- Start with defaults.
- Add primitives when integrating with a design system.
- Add converter overrides only where default behavior is insufficient.

### Primitive Resolution

Primitive replacement is handled centrally before rendering begins.

- `resolveReactNativePrimitives` merges user overrides with package defaults.
- Every default converter reads primitives from converter context instead of importing primitives directly.
- This ensures partial overrides work consistently across the full tree.

### Default Converter Coverage

The default React Native renderer currently includes converters for:

- Paragraphs
- Text formatting
- Headings
- Links
- Lists
- Line breaks
- Tabs
- Blockquotes
- Horizontal rules
- Tables
- Uploads

### Styling Model

The renderer uses lightweight inline React Native styles in default converters.

- Container styling is controlled through `containerStyle`.
- Primitive substitution is the preferred integration point for app-level theming.
- Converter overrides are the preferred integration point for node-specific presentation changes.

### Scope

The React Native entrypoint is intentionally limited to rendering.

- No editor UI
- No Lexical editor plugins
- No internal link resolution by default
- No responsive image source-set behavior

If your app needs deeper behavior, the intended extension points are primitive overrides and custom converters.

### Edge Cases, Issues, and Concerns

Potential issues to account for in production integrations:

- Unknown or custom node types: if your data includes nodes without converters, they may render as empty output unless you register an override.
- Internal links: internal Payload links are not resolved by default, so app-level route mapping is required for navigation-aware behavior.
- Deeply nested content: very large or deeply nested documents can increase render cost because conversion is recursive.
- Table rendering on small screens: table content can overflow; consider wrapping with `ScrollView` or custom table converters for mobile UX.
- Upload handling differences from web: responsive `<picture>` behavior is intentionally absent in React Native; only direct image/file rendering is provided.
- Runtime URL behavior: if `onExternalLinkPress` is omitted, opening links depends on React Native runtime availability and platform handling.

Operational concern:

- Keep serialized Lexical schema and converter support aligned during upgrades. If new node shapes are introduced in content but converter logic is not updated, rendering gaps can appear.
