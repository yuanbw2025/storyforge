import TtrpgOpenSemanticModelPanel, { type TtrpgOpenSemanticModelPanelProps } from './TtrpgOpenSemanticModelPanel'

export default function TtrpgOpenOracleModelPanel(props: Omit<TtrpgOpenSemanticModelPanelProps, 'purpose'>) {
  return <TtrpgOpenSemanticModelPanel {...props} purpose="oracle" />
}
