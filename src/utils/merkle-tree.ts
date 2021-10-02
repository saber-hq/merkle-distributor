import { keccak_256 } from "js-sha3";
import invariant from "tiny-invariant";

export class MerkleTree {
  private readonly elements: Buffer[];
  private readonly bufferElementPositionIndex: { [hexElement: string]: number };
  private readonly layers: Buffer[][];

  constructor(elements: Buffer[]) {
    this.elements = [...elements];
    // Sort elements
    this.elements.sort(Buffer.compare.bind(null));
    // Deduplicate elements
    this.elements = MerkleTree.bufDedup(this.elements);

    this.bufferElementPositionIndex = this.elements.reduce<{
      [hexElement: string]: number;
    }>((memo, el, index) => {
      memo[el.toString("hex")] = index;
      return memo;
    }, {});

    // Create layers
    this.layers = this.getLayers(this.elements);
  }

  getLayers(elements: Buffer[]): Buffer[][] {
    if (elements.length === 0) {
      throw new Error("empty tree");
    }

    const layers = [];
    layers.push(elements);

    // Get next layer until we reach the root
    while ((layers[layers.length - 1]?.length ?? 0) > 1) {
      const nextLayerIndex: Buffer[] | undefined = layers[layers.length - 1];
      invariant(nextLayerIndex, "nextLayerIndex");
      layers.push(this.getNextLayer(nextLayerIndex));
    }

    return layers;
  }

  getNextLayer(elements: Buffer[]): Buffer[] {
    return elements.reduce<Buffer[]>((layer, el, idx, arr) => {
      if (idx % 2 === 0) {
        // Hash the current element with its pair element
        const pairEl = arr[idx + 1];
        layer.push(MerkleTree.combinedHash(el, pairEl));
      }

      return layer;
    }, []);
  }

  static combinedHash(first: Buffer, second: Buffer | undefined): Buffer {
    if (!first) {
      invariant(second, "second element of pair must exist");
      return second;
    }
    if (!second) {
      invariant(first, "first element of pair must exist");
      return first;
    }

    return Buffer.from(
      keccak_256.digest(MerkleTree.sortAndConcat(first, second))
    );
  }

  getRoot(): Buffer {
    const root = this.layers[this.layers.length - 1]?.[0];
    invariant(root, "root");
    return root;
  }

  getHexRoot(): string {
    return this.getRoot().toString("hex");
  }

  getProof(el: Buffer): Buffer[] {
    const initialIdx = this.bufferElementPositionIndex[el.toString("hex")];

    if (typeof initialIdx !== "number") {
      throw new Error("Element does not exist in Merkle tree");
    }

    let idx = initialIdx;
    return this.layers.reduce((proof, layer) => {
      const pairElement = MerkleTree.getPairElement(idx, layer);

      if (pairElement) {
        proof.push(pairElement);
      }

      idx = Math.floor(idx / 2);

      return proof;
    }, []);
  }

  getHexProof(el: Buffer): string[] {
    const proof = this.getProof(el);

    return MerkleTree.bufArrToHexArr(proof);
  }

  private static getPairElement(idx: number, layer: Buffer[]): Buffer | null {
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;

    if (pairIdx < layer.length) {
      const pairEl = layer[pairIdx];
      invariant(pairEl, "pairEl");
      return pairEl;
    } else {
      return null;
    }
  }

  private static bufDedup(elements: Buffer[]): Buffer[] {
    return elements.filter((el, idx) => {
      return idx === 0 || !elements[idx - 1]?.equals(el);
    });
  }

  private static bufArrToHexArr(arr: Buffer[]): string[] {
    if (arr.some((el) => !Buffer.isBuffer(el))) {
      throw new Error("Array is not an array of buffers");
    }

    return arr.map((el) => "0x" + el.toString("hex"));
  }

  private static sortAndConcat(...args: Buffer[]): Buffer {
    return Buffer.concat([...args].sort(Buffer.compare.bind(null)));
  }
}
