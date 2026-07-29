> [!WARNING]
> This package is an extracted fork of the [`@payloadcms/richtext-lexical`](https://www.npmjs.com/package/@payloadcms/richtext-lexical) package.

> [!WARNING]
> This plugin is still **experimental**. APIs, collection schemas, and behavior may change without a stable compatibility guarantee. Use in production with caution and pin versions deliberately.

This package provides a React Native implementation of the Rich Text Renderer for serialized Lexical Editor content forked from `@payloadcms/richtext-lexical`. It includes components and utilities for rendering and managing rich text content in a React Native application.

# Installation and Usage

## Installation

Install the package using your preferred package manager:

```bash
# npm
npm install @lizardglobal/payload-richtext-lexical-react-native

# yarn
yarn add @lizardglobal/payload-richtext-lexical-react-native

# pnpm
pnpm add @lizardglobal/payload-richtext-lexical-react-native
```

### Internal Installation (Deprecated)

> **⚠️ Deprecation Warning:** Internal installation support will be removed in a future release. Please migrate to installing the package via npm, yarn, or pnpm as shown above.

If you need to integrate this package internally without publishing, you can use the built-in CLI to build and copy `dist` into your local module path:

```bash
pnpm internal:install --target YOUR_PROJECT/modules/richtext-lexical
```

This command performs the equivalent of:

```bash
pnpm build && rm -rf YOUR_PROJECT/modules/richtext-lexical/* && cp -R dist/* YOUR_PROJECT/modules/richtext-lexical/
```

If you have already built and only want to re-copy files, use:

```bash
pnpm internal:install --target YOUR_PROJECT/modules/richtext-lexical --skip-build
```

Then import the package in your project as follows:

```tsx
import { RichText } from '@/modules/richtext-lexical/exports/react-native'

const MyComponent = () => {
  return (
    <RichText
      content={/* your rich text content */}
    />
  )
}
```

**Important:** Since this is a static build, there is no built-in package resolution. **Only use code paths to features you support.** For example, if you only support the React Native export, only import from `exports/react-native` and not from `exports/react` or `exports/client`. Importing from unsupported paths may cause errors due to missing dependencies.

## Basic Usage

The simplest way to render Lexical content is to use the `RichText` component with your serialized data:

```tsx
import { RichText } from "@lizardglobal/payload-richtext-lexical/react-native";

function ArticleContent({ article }) {
  return <RichText data={article.content} />;
}
```

This will render the content using default React Native primitives (`View`, `Text`, `Image`, etc.) and built-in converters for all supported Lexical node types.

## Handling External Links

Since React Native doesn't have automatic link handling like web browsers, you should provide an `onExternalLinkPress` handler to control how external URLs are opened:

```tsx
import { RichText } from "@lizardglobal/payload-richtext-lexical/react-native";
import { Linking, Alert } from "react-native";

function ArticleContent({ article }) {
  const handleExternalLink = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert("Error", `Cannot open URL: ${url}`);
    }
  };

  return (
    <RichText 
      data={article.content} 
      onExternalLinkPress={handleExternalLink}
    />
  );
}
```

## Customizing Primitives

Primitives are the basic building blocks used to render content (e.g., `Text`, `View`, `Image`, `Pressable`). You can override these to integrate with your app's design system or add custom behavior:

```tsx
import { RichText } from "@lizardglobal/payload-richtext-lexical/react-native";
import { Text as CustomText } from "@/components/ui/Text";
import { View as CustomView } from "@/components/ui/View";
import { Pressable as CustomPressable } from "@/components/ui/Pressable";

function ArticleContent({ article }) {
  return (
    <RichText 
      data={article.content}
      primitives={{
        Text: CustomText,      // Use your themed Text component
        View: CustomView,      // Use your themed View component
        Pressable: CustomPressable, // Use your themed Pressable component
      }}
    />
  );
}
```

**Why customize primitives?**
- Apply consistent theming across your app
- Add analytics tracking to interactive elements
- Implement custom accessibility patterns
- Integrate with your existing component library

**Available primitives:**
- `Text` - Text rendering
- `View` - Container/layout elements
- `Image` - Image rendering
- `Pressable` - Interactive elements (links, buttons)

You only need to override the primitives you want to customize. Any primitives not specified will use the default React Native components.

## Customizing Converters

Converters transform Lexical node types into React Native components. You can override default converters to change how specific content types are rendered:

```tsx
import { RichText } from "@lizardglobal/payload-richtext-lexical/react-native";
import { View, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";

function ArticleContent({ article }) {
  const navigation = useNavigation();

  // Custom converter for heading nodes
  const customHeadingConverter = {
    converter: ({ node, children, primitives }) => {
      const HeadingText = primitives.Text;
      const fontSize = node.tag === 'h1' ? 32 : node.tag === 'h2' ? 24 : 18;
      
      return (
        <HeadingText 
          key={node.key}
          style={{ 
            fontSize, 
            fontWeight: 'bold', 
            marginVertical: 12,
            color: '#1a1a1a'
          }}
        >
          {children}
        </HeadingText>
      );
    },
  };

  // Custom converter for link nodes with internal navigation
  const customLinkConverter = {
    converter: ({ node, children, primitives }) => {
      const LinkPressable = primitives.Pressable;
      const LinkText = primitives.Text;
      
      const handlePress = () => {
        if (node.fields?.doc?.relationTo === 'articles') {
          // Navigate internally for article links
          navigation.navigate('Article', { id: node.fields.doc.value.id });
        } else if (node.fields?.url) {
          // Handle external links
          Linking.openURL(node.fields.url);
        }
      };

      return (
        <LinkPressable key={node.key} onPress={handlePress}>
          <LinkText style={{ color: '#007AFF', textDecorationLine: 'underline' }}>
            {children}
          </LinkText>
        </LinkPressable>
      );
    },
  };

  return (
    <RichText 
      data={article.content}
      converters={{
        heading: customHeadingConverter,
        link: customLinkConverter,
      }}
    />
  );
}
```

**Common converter customization use cases:**
- **Internal navigation:** Handle relationship links with app routing
- **Styling:** Apply custom styles beyond what primitives provide
- **Analytics:** Track when specific content types are rendered or interacted with
- **Accessibility:** Add custom accessibility labels or behaviors
- **Content transformation:** Modify or enhance content before rendering

**Note:** When you override a converter, you're responsible for the complete rendering logic for that node type. Make sure to handle all relevant node properties and edge cases.

# Implementation

This implementation adds **React Native rendering support** to the `@lizardglobal/payload-richtext-lexical-react-native` package by adding a similar entry point `@lizardglobal/payload-richtext-lexical-react-native/react-native` as the existing renderers (and specifically the React renderer) but with RN primitives.

The RN entrypoint is intended to provide a renderer-only API for serialized Lexical content in RN applications. I tried to keep the exposed API as close as possible to the existing React renderer so we can use it as a drop-in replacement in most cases, while still allowing for platform-specific behavior through converter and primitive overrides.

> **Note:** This implementation intentionally focuses on rendering serialized Lexical content in RN. It does not include editor UI components, plugin ports, or image responsiveness behavior.

## Primitives

Unlike the React renderer, I introduced a layer of abstraction for primitives in the RN renderer. Since React can be expected to run in a DOM environment, the React renderer can safely assume that primitives like `div`, `span`, and `img` are available. In contrast, RN has a different set of primitives (`View`, `Text`, `Image`, etc.) that are not globally available in the same way. They need to be "manually" imported from `react-native` and can also be wrapped or customized by applications. And even then, some primitives (like `Text`) have specific behavior and nesting rules embedded in app-specific components.

So, instead of importing RN primitives directly in each converter, I created a `resolvePrimitive` utility that maps abstract primitive names (like `Text`, `View`, `Image`, etc.) to actual RN components. This mapping can be overridden through converter context, allowing for primitive injection for customization (such as _theming, analytics instrumentation, accessibility conventions, or navigation integration without having to rewrite all converters_).

Primitive resolution is performed once and passed through converter context. In practical terms, centralized primitive resolution improves consistency when users partially override primitives (for example, only replacing `Text` and `Pressable`) instead of having to reimplement the entire converter set. It also keeps converter implementations focused on node-specific logic rather than platform-specific component management.

## Supported nodes and converters

`TODO: add a list of supported nodes and converters here, and any notable differences in behavior from the React renderer.`

## Exposed API

To align with the API exposed by the React renderer, I've tried to mimic the same structure. The main entry point is the `RichText` component, which accepts serialized Lexical content and renders it using the RN converters and primitives. For users who need more control, the lower-level conversion functions (`convertLexicalToReactNative` and `convertLexicalNodesToReactNative`) are also exposed for direct use. I also expose primitive utilities and converter types to keep custom integrations type-safe and consistent with package defaults.

## Expected usage

The expected integration flow is kept similarly aligned with the React renderer. Data fetching is left to the user, and the package focuses on rendering serialized Lexical content via the `RichText` component. Developers can optionally provide `primitives` and `converters` overrides for customization, but the default set should cover most use cases. They can also define an `onExternalLinkPress` handler to manage external URL behavior explicitly, which is important in RN where URL handling can vary by environment. By default, external links will attempt to open using `Linking.openURL`, but providing an explicit handler allows for more control and consistency across platforms. **So, to recap:**

1. Users fetch serialized Lexical data from Payload.
2. Render it with `RichText` from `@lizardglobal/payload-richtext-lexical-react-native/react-native`.
3. Provide `onExternalLinkPress` for explicit external URL behavior.
4. Add `primitives` overrides when integrating with an app design system.
5. Add `converters` overrides when default node behavior is insufficient.

## Edge cases, risks, and concerns

### Unknown or custom node types

If stored content includes node types with no registered converter, the output may be missing for those nodes. Currently, the default behavior is to render nothing for unsupported nodes, which could lead to silent content loss if not carefully managed. I haven't had time to look into the other implementation yet for how other implementations handle this, but I would be open to implementing a stricter default behavior (for example, rendering a placeholder or warning in development) if you think that would be more appropriate.

### Internal links

Internal links are not resolved by default in the RN renderer. I've left it for the developers to override the default `Link` converter and implement app-specific navigation logic, as internal link resolution is highly dependent on app routing structure and navigation libraries. In the React renderer, the exposed Link converter allows to provide a `internalDocToHref` prop for internal link resolution for simplicity. I'm not sure whether to implement this or not. The only reason I can see to implement it is to keep feature parity between renderers. I've elected not to implement it for now, due to lack of time.

### Large document trees and render performance

Obviously enough, the recursive conversion of large trees increases render cost and affects scroll performance on low-end devices. This is a general concern for rich text rendering in any environment, but especially in RN where JS thread performance is usually(?) more constrained. I will try to add profiling tests and metrics to identify specific bottlenecks and optimize converter implementations where possible, but I'm not confident enough, nor am I sure if this falls within the scope of this feature request itself. Would be happy to hear feedback on this.

### Tables

Tables in the renderer are currently implemented with basic `View` and `Text` primitives, which may not support all desired table features (like fixed headers, responsive layouts, or complex cell spanning). Cards on the table (no pun intended), it's a barebones implementation that covers basic rendering but may not meet all use cases. That's done intentionally. I hoped to get feedback on whether this is sufficient for the initial implementation or if someone could help with a better approach.

### Images

Web-specific responsive image behavior is intentionally not replicated in RN. The React renderer benefits from browser-native features like CSS media queries and automatic image scaling through srcset attributes. React Native has no equivalent mechanism. Image sizing must be explicitly specified or calculated at runtime. Additionally, Payload's upload metadata (dimensions, orientation, file size) should be leveraged by application code to implement appropriate RN-specific behaviors (such as preloading, caching strategies, or adaptive quality selection based on network conditions). Document this gap clearly so developers don't expect parity with web renderers.

### URL Handling Defaults

When `onExternalLinkPress` is omitted, runtime-level URL handling may vary by environment. Recommend always providing an explicit handler in production applications. React Native's `Linking.openURL` behavior differs across iOS and Android, and behavior is undefined in non-native environments (web, SSR contexts, testing). Defaulting to `Linking.openURL` without an explicit handler can lead to silent failures or platform-specific bugs. By requiring developers to provide an `onExternalLinkPress` handler, the package shifts responsibility to the consumer while maintaining safety and predictability.