import { createServerFeature } from '../../../../utilities/createServerFeature.js'

export const TreeViewFeature = createServerFeature({
  feature: {
    ClientFeature: '@lizardglobal/payload-richtext-lexical-react-native/client#TreeViewFeatureClient',
  },
  key: 'treeView',
})
