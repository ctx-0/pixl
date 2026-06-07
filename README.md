# Pixl

An interactive visualization of pixel shuffle (space-to-depth) as used in SmolVLM2, for vision token compression [1].


<p align="center">
  <img src="image-1.png" alt="Pixel shuffle visualization view 1" height="260">
  <img src="image-2.png" alt="Pixel shuffle visualization view 2" height="260">
</p>

**Live**: https://ctx-0.github.io/pixel-shuffle/

Pixel unshuffle, or space-to-depth, reduces spatial resolution and increases channel depth:

`(H * r) x (W * r) x C -> H x W x (C * r^2)`

Start with an image grid.

Choose a block size, like 2, 4, or 8.

    For every small block of pixels:
      Take the pixels in that block.
      Keep the block's top-left position as the new spatial position.
      Move each pixel inside the block into a different channel slot.

So nearby pixels in image space become stacked values in channel depth.

No pixel values are changed. Only their addresses are rearranged.
We visualize this rearrangement as a 3D stack so the movement from image space into channel depth is easier to see.

The reverse operation is pixel shuffle, or depth-to-space:

`H x W x (C * r^2) -> (H * r) x (W * r) x C`

## Presets

Preset images live in `presets/` as lossless `64x64` RGBA PNGs. Transparent pixels are omitted from the visualization; visible pixels must be fully opaque.

Add a PNG to `presets/`, then add its label and path to `PRESET_MANIFEST` in `app.js`. All preset images are preloaded and decoded before the animation starts.

## References

[1] Andrés Marafioti et al. "SmolVLM: Redefining small and efficient multimodal models." arXiv:2504.05299, 2025. https://arxiv.org/abs/2504.05299

[2] Hugging Face. "SmolVLM2: Bringing Video Understanding to Every Device." https://huggingface.co/blog/smolvlm2

[3] https://github.com/huggingface/smollm/blob/a041759883ec7152d18fb985ea49be641a0bceef/vision/m4/models/vllama3/modeling_vllama3.py#L1281-L1290

