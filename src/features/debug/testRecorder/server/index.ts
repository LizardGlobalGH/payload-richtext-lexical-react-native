import { createServerFeature } from '../../../../utilities/createServerFeature.js'

export const TestRecorderFeature = createServerFeature({
  feature: {
    ClientFeature: '@lizardglobal/payload-richtext-lexical-react-native/client#TestRecorderFeatureClient',
  },
  key: 'testRecorder',
})
