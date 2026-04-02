import type { SerializedLineBreakNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const LinebreakReactNativeConverter: ReactNativeConverters<SerializedLineBreakNode> = {
  linebreak: ({ context }) => {
    const TextPrimitive = context.primitives.Text

    return <TextPrimitive>{'\n'}</TextPrimitive>
  },
}
