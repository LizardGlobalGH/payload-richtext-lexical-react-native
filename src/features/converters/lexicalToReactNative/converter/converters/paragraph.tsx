import type { SerializedParagraphNode } from "../../../../../nodeTypes.js";
import type { ReactNativeConverters } from "../types.js";

export const ParagraphReactNativeConverter: ReactNativeConverters<SerializedParagraphNode> =
  {
    paragraph: ({ context, node, nodesToReactNative, ...props }) => {
      const children = nodesToReactNative({
        nodes: node.children,
        context,
        ...props,
      });

      const TextPrimitive = context.primitives.Text;
      const ViewPrimitive = context.primitives.View;

      if (!children?.length) {
        return <TextPrimitive>{"\n"}</TextPrimitive>;
      }

      return <TextPrimitive>{children}</TextPrimitive>;
    },
  };
