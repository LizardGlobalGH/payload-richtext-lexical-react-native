import type { SerializedHorizontalRuleNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const HorizontalRuleReactNativeConverter: ReactNativeConverters<SerializedHorizontalRuleNode> =
  {
    horizontalrule: ({ context }) => {
      const ViewPrimitive = context.primitives.View

      return <ViewPrimitive style={{ backgroundColor: '#D1D5DB', height: 1, marginVertical: 8 }} />
    },
  }
