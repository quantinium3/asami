import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface Settings {
    blockSize: number;
    brightness: number;
    autoAdjust: boolean;
    detectEdges: boolean;
    color: boolean;
    invertColor: boolean;
    asciiChars: string;
    sigma1: number;
    sigma2: number;
}

const Generator: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragAreaRef = useRef<HTMLDivElement>(null);
    const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
    const [asciiText, setAsciiText] = useState<string>('');
    const [settings, setSettings] = useState<Settings>({
        blockSize: 8,
        brightness: 1.0,
        autoAdjust: true,
        detectEdges: false,
        color: true,
        invertColor: false,
        asciiChars: ' .:-=+*#%@',
        sigma1: 0.5,
        sigma2: 1.0
    });

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (dragAreaRef.current) {
            dragAreaRef.current.style.borderColor = 'var(--accent)';
        }
    };

    const handleDragLeave = () => {
        if (dragAreaRef.current) {
            dragAreaRef.current.style.borderColor = 'var(--border-color)';
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (dragAreaRef.current) {
            dragAreaRef.current.style.borderColor = 'var(--border-color)';
        }
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleFile(file);
        }
    };

    const handleFile = async (file: File) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(resolve => img.onload = resolve);
        setOriginalImage(img);
    };

    const rgbToGrayscale = (imageData: ImageData) => {
        const gray = new Uint8Array(imageData.width * imageData.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            gray[i / 4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        return gray;
    };

    const gaussianKernel = (sigma: number) => {
        const size = Math.ceil(6 * sigma);
        const kernel = new Float32Array(size);
        const half = size / 2;
        let sum = 0;

        for (let i = 0; i < size; i++) {
            const x = i - half;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }

        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }

        return kernel;
    };

    const applyGaussianBlur = (imageData: ImageData, sigma: number) => {
        const width = imageData.width;
        const height = imageData.height;
        const kernel = gaussianKernel(sigma);
        const temp = new Uint8Array(width * height);
        const result = new Uint8Array(width * height);
        const gray = rgbToGrayscale(imageData);

        // Horizontal pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let i = 0; i < kernel.length; i++) {
                    const ix = x + i - Math.floor(kernel.length / 2);
                    if (ix >= 0 && ix < width) {
                        sum += gray[y * width + ix] * kernel[i];
                    }
                }
                temp[y * width + x] = sum;
            }
        }

        // Vertical pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let i = 0; i < kernel.length; i++) {
                    const iy = y + i - Math.floor(kernel.length / 2);
                    if (iy >= 0 && iy < height) {
                        sum += temp[iy * width + x] * kernel[i];
                    }
                }
                result[y * width + x] = sum;
            }
        }

        return result;
    };

    const differenceOfGaussians = (imageData: ImageData) => {
        const blur1 = applyGaussianBlur(imageData, settings.sigma1);
        const blur2 = applyGaussianBlur(imageData, settings.sigma2);
        const result = new Uint8Array(imageData.width * imageData.height);

        for (let i = 0; i < result.length; i++) {
            const diff = blur1[i] - blur2[i];
            result[i] = Math.max(0, Math.min(255, diff + 128));
        }

        return result;
    };

    const applySobelFilter = (grayData: Uint8Array, width: number, height: number) => {
        const Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
        const Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
        const magnitude = new Float32Array(width * height);
        const direction = new Float32Array(width * height);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0, gy = 0;

                for (let i = 0; i < 3; i++) {
                    for (let j = 0; j < 3; j++) {
                        const pixel = grayData[(y + i - 1) * width + (x + j - 1)];
                        gx += Gx[i][j] * pixel;
                        gy += Gy[i][j] * pixel;
                    }
                }

                magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
                direction[y * width + x] = Math.atan2(gy, gx);
            }
        }

        return { magnitude, direction };
    };

    const getEdgeChar = (magnitude: number, direction: number) => {
        const threshold = 50;
        if (magnitude < threshold) {
            return null;
        }

        const angle = (direction + Math.PI) * (180 / Math.PI);
        const index = Math.floor(((angle + 22.5) % 180) / 45);
        return ['-', '\\', '|', '/', '-', '\\', '|', '/'][index];
    };

    const autoBrightnessContrast = (imageData: ImageData) => {
        const gray = rgbToGrayscale(imageData);
        const histogram = new Array(256).fill(0);

        for (let i = 0; i < gray.length; i++) {
            histogram[gray[i]]++;
        }

        const accumulator = new Array(256);
        accumulator[0] = histogram[0];
        for (let i = 1; i < 256; i++) {
            accumulator[i] = accumulator[i - 1] + histogram[i];
        }

        const max = accumulator[255];
        const clipPercent = 1;
        const clipHistCount = Math.floor((max * clipPercent) / 100 / 2);

        let minGray = 0;
        while (accumulator[minGray] < clipHistCount) minGray++;

        let maxGray = 255;
        while (accumulator[maxGray] >= max - clipHistCount) maxGray--;

        const alpha = 255 / (maxGray - minGray);
        const beta = -minGray * alpha;

        const result = new Uint8ClampedArray(imageData.data.length);
        for (let i = 0; i < imageData.data.length; i++) {
            result[i] = imageData.data[i] * alpha + beta;
        }

        return new ImageData(result, imageData.width, imageData.height);
    };

    const calculateBlockInfo = (imageData: ImageData, x: number, y: number, edgeData: { magnitude: Float32Array, direction: Float32Array } | null) => {
        const width = imageData.width;
        const height = imageData.height;
        const blockW = Math.min(settings.blockSize, width - x);
        const blockH = Math.min(settings.blockSize, height - y);

        let sumBrightness = 0;
        const sumColor = [0, 0, 0];
        let pixelCount = 0;
        let sumMag = 0;
        let sumDir = 0;

        for (let dy = 0; dy < blockH; dy++) {
            for (let dx = 0; dx < blockW; dx++) {
                const ix = x + dx;
                const iy = y + dy;
                const i = (iy * width + ix) * 4;

                if (ix >= width || iy >= height || i + 2 >= imageData.data.length) continue;

                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

                sumBrightness += gray;
                if (settings.color) {
                    sumColor[0] += r;
                    sumColor[1] += g;
                    sumColor[2] += b;
                }

                if (settings.detectEdges && edgeData) {
                    const edgeIndex = iy * width + ix;
                    sumMag += edgeData.magnitude[edgeIndex];
                    sumDir += edgeData.direction[edgeIndex];
                }

                pixelCount++;
            }
        }

        return { sumBrightness, sumColor, pixelCount, sumMag, sumDir };
    };

    const selectAsciiChar = (blockInfo: { sumBrightness: number, pixelCount: number, sumMag: number, sumDir: number }) => {
        const avgBrightness = Math.floor(blockInfo.sumBrightness / blockInfo.pixelCount);
        const boostedBrightness = Math.floor(avgBrightness * settings.brightness);
        const clampedBrightness = Math.max(0, Math.min(255, boostedBrightness));

        if (settings.detectEdges) {
            const avgMag = blockInfo.sumMag / blockInfo.pixelCount;
            const avgDir = blockInfo.sumDir / blockInfo.pixelCount;
            const edgeChar = getEdgeChar(avgMag, avgDir);
            if (edgeChar) return edgeChar;
        }

        if (clampedBrightness === 0) return ' ';
        const charIndex = Math.floor((clampedBrightness * settings.asciiChars.length) / 256);
        return settings.asciiChars[Math.min(charIndex, settings.asciiChars.length - 1)];
    };

    const calculateAverageColor = (blockInfo: { sumColor: number[], pixelCount: number }) => {
        if (!settings.color) return [255, 255, 255];

        const color = blockInfo.sumColor.map(sum =>
            Math.floor(sum / blockInfo.pixelCount)
        );
        if (settings.invertColor) {
            return color.map(c => 255 - c);
        }
        return color;
    };

    const generate = async () => {
        if (!originalImage || !canvasRef.current) return;

        const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const scaleFactor = 4;
        const width = originalImage.width;
        const height = originalImage.height;

        canvasRef.current.width = width;
        canvasRef.current.height = height;

        ctx.drawImage(originalImage, 0, 0);
        let imageData = ctx.getImageData(0, 0, width, height);

        if (settings.autoAdjust) {
            imageData = autoBrightnessContrast(imageData);
        }

        let edgeData = null;
        if (settings.detectEdges) {
            const dogResult = differenceOfGaussians(imageData);
            edgeData = applySobelFilter(dogResult, width, height);
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = width * scaleFactor;
        outCanvas.height = height * scaleFactor;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) return;

        outCtx.scale(scaleFactor, scaleFactor);

        let newAsciiText = '';

        for (let y = 0; y < height; y += settings.blockSize) {
            let rowText = '';
            for (let x = 0; x < width; x += settings.blockSize) {
                const blockInfo = calculateBlockInfo(imageData, x, y, edgeData);
                const char = selectAsciiChar(blockInfo);
                const color = calculateAverageColor(blockInfo);

                outCtx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                outCtx.font = `${settings.blockSize}px monospace`;
                outCtx.fillText(char, x, y + settings.blockSize);

                rowText += char;
            }
            newAsciiText += rowText + '\n';
        }

        setAsciiText(newAsciiText);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = settings.invertColor ? '#ffffff' : '#000000';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(outCanvas, 0, 0, outCanvas.width, outCanvas.height, 0, 0, width, height);
    };

    const downloadImage = () => {
        if (!canvasRef.current?.toDataURL) return;

        const link = document.createElement('a');
        link.download = 'ascii-art.png';
        link.href = canvasRef.current.toDataURL('image/png');
        link.click();
    };

    const copyImage = async () => {
        try {
            await navigator.clipboard.writeText(asciiText);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    useEffect(() => {
        if (originalImage) {
            generate();
        }
    }, [originalImage, settings]);

    const handleSettingChange = (key: keyof Settings, value: any) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="w-full max-w-4xl mx-auto">
            <div className="flex flex-col gap-5">
                <main>
                    <div className="bg-white rounded-lg shadow">
                        <div className="font-bold text-3xl mb-4">
                            Ascii Art Generator
                        </div>
                        <div
                            ref={dragAreaRef}
                            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                            />
                            <div className="flex flex-col items-center gap-2">
                                <Upload className="w-16 h-16 text-gray-400" />
                                <p className="text-gray-600">Drop your image here or click to upload</p>
                            </div>
                        </div>

                        <div className="mt-4 space-y-4">
                            <div className="space-y-4">
                                <label className="block">
                                    <span className="text-gray-700">Block Size</span>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="range"
                                            min="1"
                                            max="12"
                                            value={settings.blockSize}
                                            onChange={(e) => handleSettingChange('blockSize', parseInt(e.target.value))}
                                            className="w-full"
                                        />
                                        <span className="text-sm text-gray-600 w-8">{settings.blockSize}</span>
                                    </div>
                                </label>

                                <label className="block">
                                    <span className="text-gray-700">Brightness</span>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="range"
                                            min="0.1"
                                            max="2"
                                            step="0.1"
                                            value={settings.brightness}
                                            onChange={(e) => handleSettingChange('brightness', parseFloat(e.target.value))}
                                            className="w-full"
                                        />
                                        <span className="text-sm text-gray-600 w-8">{settings.brightness.toFixed(1)}</span>
                                    </div>
                                </label>
                            </div>

                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.autoAdjust}
                                        onChange={(e) => handleSettingChange('autoAdjust', e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-gray-700">Auto Adjust</span>
                                </label>

                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.color}
                                        onChange={(e) => handleSettingChange('color', e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-gray-700">Color</span>
                                </label>

                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.invertColor}
                                        onChange={(e) => handleSettingChange('invertColor', e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-gray-700">Invert</span>
                                </label>

                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={settings.detectEdges}
                                        onChange={(e) => handleSettingChange('detectEdges', e.target.checked)}
                                        className="rounded"
                                    />
                                    <span className="text-sm text-gray-700">Edge Detection</span>
                                </label>
                            </div>

                            {settings.detectEdges && (
                                <div className="space-y-4">
                                    <label className="block">
                                        <span className="text-gray-700">Sigma 1</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min="0.1"
                                                max="2.0"
                                                step="0.1"
                                                value={settings.sigma1}
                                                onChange={(e) => handleSettingChange('sigma1', parseFloat(e.target.value))}
                                                className="w-full"
                                            />
                                            <span className="text-sm text-gray-600 w-8">{settings.sigma1.toFixed(1)}</span>
                                        </div>
                                    </label>

                                    <label className="block">
                                        <span className="text-gray-700">Sigma 2</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min="0.1"
                                                max="2.0"
                                                step="0.1"
                                                value={settings.sigma2}
                                                onChange={(e) => handleSettingChange('sigma2', parseFloat(e.target.value))}
                                                className="w-full"
                                            />
                                            <span className="text-sm text-gray-600 w-8">{settings.sigma2.toFixed(1)}</span>
                                        </div>
                                    </label>
                                </div>
                            )}

                            <div>
                                <label className="block">
                                    <span className="text-gray-700">ASCII Characters</span>
                                    <input
                                        type="text"
                                        value={settings.asciiChars}
                                        onChange={(e) => handleSettingChange('asciiChars', e.target.value)}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    />
                                </label>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={copyImage}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                >
                                    Copy Image
                                </button>
                                <button
                                    onClick={downloadImage}
                                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                                >
                                    Download
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow p-4">
                        <canvas
                            ref={canvasRef}
                            className="w-full h-auto"
                        />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default Generator;

