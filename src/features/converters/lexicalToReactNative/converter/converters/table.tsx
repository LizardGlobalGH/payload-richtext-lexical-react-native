import type {
  SerializedTableCellNode,
  SerializedTableNode,
  SerializedTableRowNode,
} from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

export const TableReactNativeConverter: ReactNativeConverters<
  SerializedTableCellNode | SerializedTableNode | SerializedTableRowNode
> = {
  table: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const ScrollViewPrimitive = context.primitives.ScrollView
    const ViewPrimitive = context.primitives.View

    return (
      <ScrollViewPrimitive horizontal={true}>
        <ViewPrimitive>{children}</ViewPrimitive>
      </ScrollViewPrimitive>
    )
  },
  tablecell: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const TextPrimitive = context.primitives.Text
    const ViewPrimitive = context.primitives.View

    return (
      <ViewPrimitive
        style={{
          backgroundColor: node.backgroundColor || undefined,
          borderColor: '#CBD5E1',
          borderWidth: 1,
          minWidth: 120,
          paddingHorizontal: 8,
          paddingVertical: 6,
        }}
      >
        {node.headerState > 0 ? (
          <TextPrimitive style={{ fontWeight: '700' }}>{children}</TextPrimitive>
        ) : (
          children
        )}
      </ViewPrimitive>
    )
  },
  tablerow: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const ViewPrimitive = context.primitives.View

    return <ViewPrimitive style={{ flexDirection: 'row' }}>{children}</ViewPrimitive>
  },
}
