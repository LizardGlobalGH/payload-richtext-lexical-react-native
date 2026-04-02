import type { SerializedListItemNode, SerializedListNode } from '../../../../../nodeTypes.js'
import type { ReactNativeConverters } from '../types.js'

const listMarker = (args: { isChecked?: boolean; listType?: string; value?: number }): string => {
  if (args.listType === 'check') {
    return args.isChecked ? '\u2611' : '\u2610'
  }

  if (args.listType === 'number') {
    return `${args.value ?? 1}.`
  }

  return '\u2022'
}

export const ListReactNativeConverter: ReactNativeConverters<
  SerializedListItemNode | SerializedListNode
> = {
  list: ({ context, node, nodesToReactNative }) => {
    const children = nodesToReactNative({
      nodes: node.children,
    })

    const ViewPrimitive = context.primitives.View

    return <ViewPrimitive>{children}</ViewPrimitive>
  },
  listitem: ({ context, node, nodesToReactNative, parent }) => {
    const hasSubLists = node.children.some((child) => child.type === 'list')

    const children = nodesToReactNative({
      nodes: node.children,
    })

    const TextPrimitive = context.primitives.Text
    const ViewPrimitive = context.primitives.View

    if (hasSubLists) {
      return <ViewPrimitive>{children}</ViewPrimitive>
    }

    const marker =
      'listType' in parent && typeof parent.listType === 'string'
        ? listMarker({
            isChecked: node.checked,
            listType: parent.listType,
            value: node.value,
          })
        : '\u2022'

    return (
      <ViewPrimitive style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 8 }}>
        <TextPrimitive>{marker}</TextPrimitive>
        <ViewPrimitive style={{ flexShrink: 1 }}>{children}</ViewPrimitive>
      </ViewPrimitive>
    )
  },
}
