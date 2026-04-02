import type { FileData, TypeWithID } from 'payload'

import type { SerializedUploadNode } from '../../../../../nodeTypes.js'
import type { UploadDataImproved } from '../../../../upload/server/nodes/UploadNode.js'
import type { ReactNativeConverters } from '../types.js'

import { openExternalURL } from '../primitives.js'

export const UploadReactNativeConverter: ReactNativeConverters<SerializedUploadNode> = {
  upload: ({ context, node }) => {
    const uploadNode = node as UploadDataImproved

    if (typeof uploadNode.value !== 'object') {
      return null
    }

    const uploadDoc = uploadNode.value as FileData & TypeWithID
    const url = uploadDoc.url

    if (!url) {
      return null
    }

    const alt = (uploadNode.fields?.alt as string) || (uploadDoc as { alt?: string }).alt || ''

    if (!uploadDoc.mimeType.startsWith('image')) {
      const PressablePrimitive = context.primitives.Pressable
      const TextPrimitive = context.primitives.Text

      return (
        <PressablePrimitive
          accessibilityRole="link"
          onPress={() => {
            if (context.onExternalLinkPress) {
              context.onExternalLinkPress({
                newTab: true,
                url,
              })
              return
            }

            openExternalURL(url)
          }}
        >
          <TextPrimitive style={{ color: '#2563EB', textDecorationLine: 'underline' }}>
            {uploadDoc.filename}
          </TextPrimitive>
        </PressablePrimitive>
      )
    }

    const ImagePrimitive = context.primitives.Image

    return (
      <ImagePrimitive
        accessibilityLabel={alt}
        source={{
          uri: url,
        }}
        style={{
          height: uploadDoc.height || undefined,
          maxWidth: '100%',
          width: uploadDoc.width || undefined,
        }}
      />
    )
  },
}
