import { createServerFeature } from '../../../utilities/createServerFeature.js'

export const SuperscriptFeature = createServerFeature({
  feature: {
    ClientFeature: '@lizardglobal/payload-richtext-lexical-react-native/client#SuperscriptFeatureClient',
  },
  key: 'superscript',
})
