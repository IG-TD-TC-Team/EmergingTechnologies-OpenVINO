from optimum.intel import OVModelForCausalLM
from transformers import AutoTokenizer

model_id = "microsoft/Phi-3-mini-4k-instruct"
output_dir = "models/phi3-mini-ov"

print("Loading tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(model_id)
tokenizer.save_pretrained(output_dir)

print("Converting model to OpenVINO IR...")
model = OVModelForCausalLM.from_pretrained(model_id, export=True)
model.save_pretrained(output_dir)

print(f"Done — model saved to {output_dir}")