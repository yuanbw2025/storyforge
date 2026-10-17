import TtrpgOpenSemanticModelPanel, { type TtrpgOpenSemanticModelPanelProps } from './TtrpgOpenSemanticModelPanel'

export default function TtrpgOpenNormalizationModelPanel(props: Omit<TtrpgOpenSemanticModelPanelProps, 'purpose'>) {
  return <TtrpgOpenSemanticModelPanel {...props} purpose="normalization" />
}
