import type { DefaultNodeTypes } from '../../../../nodeTypes.js'
import type { ReactNativeConverters } from './types.js'

import { BlockquoteReactNativeConverter } from './converters/blockquote.js'
import { HeadingReactNativeConverter } from './converters/heading.js'
import { HorizontalRuleReactNativeConverter } from './converters/horizontalRule.js'
import { LinebreakReactNativeConverter } from './converters/linebreak.js'
import { LinkReactNativeConverter } from './converters/link.js'
import { ListReactNativeConverter } from './converters/list.js'
import { ParagraphReactNativeConverter } from './converters/paragraph.js'
import { TabReactNativeConverter } from './converters/tab.js'
import { TableReactNativeConverter } from './converters/table.js'
import { TextReactNativeConverter } from './converters/text.js'
import { UploadReactNativeConverter } from './converters/upload.js'

export const defaultReactNativeConverters: ReactNativeConverters<DefaultNodeTypes> = {
  ...ParagraphReactNativeConverter,
  ...TextReactNativeConverter,
  ...LinebreakReactNativeConverter,
  ...BlockquoteReactNativeConverter,
  ...TableReactNativeConverter,
  ...HeadingReactNativeConverter,
  ...HorizontalRuleReactNativeConverter,
  ...ListReactNativeConverter,
  ...LinkReactNativeConverter,
  ...UploadReactNativeConverter,
  ...TabReactNativeConverter,
}
