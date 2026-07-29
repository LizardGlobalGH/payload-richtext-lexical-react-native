import { createServerFeature } from '../../../utilities/createServerFeature.js'
import { INLINE_CODE } from './markdownTransformers.js'

export const InlineCodeFeature = createServerFeature({
  feature: {
    ClientFeature: '@lizardglobal/payload-richtext-lexical-react-native/client#InlineCodeFeatureClient',
    markdownTransformers: [INLINE_CODE],
  },
  key: 'inlineCode',
})
