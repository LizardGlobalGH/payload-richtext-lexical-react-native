import { createServerFeature } from '../../../../utilities/createServerFeature.js'

export const InlineToolbarFeature = createServerFeature({
  feature: {
    ClientFeature: '@lizardglobal/payload-richtext-lexical-react-native/client#InlineToolbarFeatureClient',
  },
  key: 'toolbarInline',
})
