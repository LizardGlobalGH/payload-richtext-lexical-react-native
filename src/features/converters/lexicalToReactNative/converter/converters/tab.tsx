import type { SerializedTabNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const TabReactNativeConverter: ReactNativeConverters<SerializedTabNode> = {
  tab: ({ context }) => {
    const TextPrimitive = context.primitives.Text

    return <TextPrimitive>{'\t'}</TextPrimitive>
  },
}
