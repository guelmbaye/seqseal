import { BedrockRuntimeClient, ConverseCommand, type ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import {
  INTERPRETATION_SCHEMA_VERSION,
  InterpretationSchemaError,
  InterpreterUnavailableError,
  interpretationJsonSchema,
  interpretationSystemPrompt,
  interpretationUserPrompt,
  validateInterpretationOutput,
  type EvidenceInterpreter,
  type InterpretationRequest,
  type InterpretationResult,
} from "@seqseal/evidence-model";

export type MediaLoader = (req: InterpretationRequest) => Promise<{ bytes: Uint8Array; format: "jpeg" | "png" } | undefined>;

/**
 * Amazon Bedrock evidence interpreter (Converse API, forced tool use with a strict JSON schema).
 *
 * The model is asked ONE question — does this selected Ring artifact support the
 * proposed workflow state? Its only output channel is a schema with no verdict or
 * action fields; anything else is rejected, never repaired. The Lambda running this
 * code has no permission to write evaluations, decisions or workflow state, and the
 * Sequence Evaluator has no bedrock:InvokeModel permission at all.
 */
export class BedrockEvidenceInterpreter implements EvidenceInterpreter {
  readonly id: string;
  constructor(
    private readonly modelId: string,
    private readonly loadMedia: MediaLoader,
    private readonly client = new BedrockRuntimeClient({}),
  ) {
    this.id = `bedrock:${modelId}`;
  }

  async interpret(req: InterpretationRequest): Promise<InterpretationResult> {
    const media = req.media ?? (await this.loadMedia(req));
    if (!media) throw new InterpreterUnavailableError("No readable media for this observation; evidence remains unresolved.");
    const content: ContentBlock[] = [{ text: interpretationUserPrompt(req) }, { image: { format: media.format, source: { bytes: media.bytes } } }];
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: interpretationSystemPrompt() }],
        messages: [{ role: "user", content }],
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: "record_evidence_assessment",
                description: "Record whether the image supports the proposed physical workflow state. Evidence assessment only.",
                inputSchema: { json: interpretationJsonSchema(req.allowed_states) as never },
              },
            },
          ],
          toolChoice: { tool: { name: "record_evidence_assessment" } },
        },
        inferenceConfig: { maxTokens: 300, temperature: 0 },
      }),
    );
    const toolUse = res.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
    if (!toolUse) throw new InterpretationSchemaError("Model returned no structured assessment.");
    const v = validateInterpretationOutput(toolUse.input, req.allowed_states);
    return { ...v, model_id: this.modelId, schema_version: INTERPRETATION_SCHEMA_VERSION };
  }
}
