"use strict";

import Bitfield from "bitfield"

const textDecoder = new TextDecoder()

let outputCanvas
let dirList

window.addEventListener("DOMContentLoaded", () => {

	document.body.addEventListener("dragenter", noEvent)
	document.body.addEventListener("dragover", noEvent)
	document.body.addEventListener("drop", handleDrop)
	Array("drag", "dragenter", "dragend", "dragleave", "drop").forEach(name => {
		document.body.addEventListener(name, visualDrag, true)
	})

	document.getElementById("wadPicker").addEventListener("change", loadFromFilePicker)

	dirList = document.getElementById("dirList")
	dirList.addEventListener("change", viewFileFromList)

	outputCanvas = document.getElementById("output").children[0]

	document.getElementById("paletteInput").addEventListener("change", changePalette)
	document.getElementById("paletteInput").value = 0

	document.getElementById("colmapInput").addEventListener("change", changeColmap)
	document.getElementById("colmapInput").value = 0

})

function buildDIRList() {
	dirList.replaceChildren(
		...directory.map((entry, i) => buildEle("option", {
			textContent: entry.name,
			attr: {
				value: i
			}
		}))
	)
}
function viewFileFromList(e) {
	readImage(directory[this[this.selectedIndex].value])
}

let wadData
const headerFMT = {
	text: { offset: 0, len: 4, isText: true },
	dirLen: { offset: 4, len: 4 },
	dirLoc: { offset: 8, len: 4 },
}
const dataHeader = {
	text: "",
	dirLen: 0,
	dirLoc: 0
}
const dirEntryLen = 16
const dirEntryInfo = {
	offset: 0,
	size: 4,
	name: 8
}
const dirEntrySize = 4
const directory = []
// Colour palette handling should be improved to load them all in a pool, and then we can pick the palette used when drawing
const colourPalette = []
let currentPalette = 0
const colourMap = []
let currentColMap = 0
const imageData = []

function readWAD() {

	imageData.splice(0, imageData.length)

	const headerData = wadData.slice(0, 12)
	const headerDataView = new DataView(headerData.buffer)

	Object.keys(headerFMT).forEach((part, i) => {
		const sectionInfo = headerFMT[part]
		if (sectionInfo.isText) {
			dataHeader[part] = textDecoder.decode(headerData.slice(sectionInfo.offset, sectionInfo.offset + sectionInfo.len))
		} else {
			dataHeader[part] = headerDataView.getInt32(sectionInfo.offset, true)
		}
	})

	if (dataHeader.text !== "IWAD" && dataHeader.text !== "PWAD") {
		console.warn("Not a WAD file.")
		document.getElementById("noWAD").classList.remove("ok")
		return
	}

	document.getElementById("noWAD").classList.add("ok")

	readDIRListing()

	buildDIRList()

	loadPalettes()

	const defaultSelected = Array.from(dirList.options).find(ele => ele.textContent === "PLAYA1")
	if (defaultSelected) {
		dirList.selectedIndex = defaultSelected.value
		readImage("PLAYA1")
	}
}

function readDIRListing() {
	if (dataHeader.dirLen === 0 || dataHeader.dirLoc === 0) {
		return
	}

	directory.splice(0, directory.length)

	const dirData = wadData.slice(dataHeader.dirLoc, dataHeader.dirLoc + (dataHeader.dirLen * dirEntryLen))
	const dirDataView = new DataView(dirData.buffer)

	for (let dI = 0, dataOffset = 0; dI < dataHeader.dirLen; dI++, dataOffset += dirEntryLen) {
		directory.push({
			offset: dirDataView.getInt32(dataOffset + dirEntryInfo.offset, true),
			size: dirDataView.getInt32(dataOffset + dirEntryInfo.size, true),
			name: getTrimmedString(dataHeader.dirLoc + dataOffset + dirEntryInfo.name, 8)
		})
	}
}

function getFileInfo(name) {
	const info = directory.find(entry => entry.name === name)

	if (!info) {
		console.warn("Could not find", name, "in the directory")

		return {
			offset: 0,
			size: 0,
			name: ""
		}
	}

	return info
}

function readImage(info) {

	if (typeof info === "string") {
		info = getFileInfo(info)
	}

	if (
		info.size === 0 ||
		typeof wadData[info.offset] === "undefined" ||
		typeof wadData[info.offset + info.size] === "undefined"
	) {
		console.warn("Invalid file data")
		return
	}

	if (imageData[info.name]) {
		drawImage(info.name)
		return
	}

	console.log("Reading", info.name)

	const imgData = wadData.slice(info.offset, info.offset + info.size)
	const imgDataView = new DataView(imgData.buffer)
	//console.log(imgData)


	const imgHeader = {
		width: 0,
		height: 0,
		offsetX: 0,
		offsetY: 0
	}

	let headerOffset = 0
	Object.keys(imgHeader).forEach(part => {
		imgHeader[part] = imgDataView.getUint16(headerOffset, true)
		headerOffset += 2
	})

	if (imgHeader.width > 320 || imgHeader.height > 320) {
		console.warn("I don't think this is an image.")
		return
	}


	const columnOffsetData = new DataView(imgData.slice(headerOffset, headerOffset + (imgHeader.width * 4)).buffer)

	const pixelData = new Uint8Array(imgHeader.width * imgHeader.height)
	const alphaChannel = new Bitfield(imgHeader.width * imgHeader.height)

	for (let c = 0; c < imgHeader.width; c++) {

		let dataPointer = columnOffsetData.getUint32(c * 4, true)

		do {
			const row = imgData[dataPointer]
			let postHeight = imgData[++dataPointer]

			if (row !== 255 && postHeight !== 255) {
				dataPointer++ // unused value

				for (let i = 0; i < postHeight; i++) {
					if (row + i < imgHeader.height && dataPointer < imgData.length - 1) {
						const index = ((row + i) * imgHeader.width) + c
						pixelData[index] = imgData[++dataPointer]
						alphaChannel.set(index)
					}
				}

				dataPointer++ // unused value
			} else {
				break
			}

		} while (dataPointer < imgData.length - 1 && imgData[++dataPointer] !== 255)
	}

	imageData[info.name] = {
		header: { ...imgHeader },
		pixelData: pixelData.slice(0, pixelData.length),
		alphaChannel: alphaChannel,
		//bitmap: []
	}

	drawImage(info.name)
}

function drawImage(name) {

	if (!imageData[name]) {
		console.warn("No image data found for", name)
		return
	}

	const imgData = imageData[name]

	const imgInfoCont = document.getElementById("imgInfo")
	imgInfoCont.children[0].children[0].textContent = imgData.header.width + ' x ' + imgData.header.width
	imgInfoCont.children[1].children[0].textContent = imgData.header.offsetX + ' x ' + imgData.header.offsetY

	const imgCanvas = outputCanvas
	imgCanvas.width = imgData.header.width
	imgCanvas.height = imgData.header.height
	const imgCTX = imgCanvas.getContext('2d')
	imgCTX.clearRect(0, 0, imgData.header.width, imgData.header.height)

	if (imgData.bitmap && currentPalette === 0 && currentColMap === 0) {
		imgCTX.drawImage(imgData.bitmap, 0, 0)
		return
	}

	console.log("Attempting to draw", name)


	const imgDataBuffer = new ImageData(imgData.header.width, imgData.header.height)
	imgData.pixelData.forEach((paletteIndex, i) => {
		if (imgData.alphaChannel.get(i)) {
			const mappedIndex = colourMap[currentColMap][paletteIndex]
			imgDataBuffer.data[i * 4 + 0] = colourPalette[currentPalette][mappedIndex * 3 + 0]
			imgDataBuffer.data[i * 4 + 1] = colourPalette[currentPalette][mappedIndex * 3 + 1]
			imgDataBuffer.data[i * 4 + 2] = colourPalette[currentPalette][mappedIndex * 3 + 2]
			imgDataBuffer.data[i * 4 + 3] = 255
		}
	})

	imgCTX.putImageData(imgDataBuffer, 0, 0)

	//This is where you make the canvas an imagebitmap and store it in the imageData
	if (currentPalette === 0 && currentColMap === 0) {
		createImageBitmap(imgCanvas, 0, 0, imgData.header.width, imgData.header.height).then(spr => {
			imageData[name].bitmap = spr
		})
	}
}

function loadPalettes() {
	Array(
		["PLAYPAL", colourPalette, 256 * 3],
		["COLORMAP", colourMap, 256]
	).forEach(palInfo => {
		palInfo[1].splice(0, palInfo[1].length)

		const fileInfo = getFileInfo(palInfo[0])

		for (let p = 0; p < fileInfo.size / palInfo[2]; p++) {
			const pOffset = fileInfo.offset + (p * palInfo[2])
			palInfo[1].push(wadData.slice(pOffset, pOffset + palInfo[2]))
		}
	})

	const palInput = document.getElementById("paletteInput")
	palInput.max = colourPalette.length

	const colmapInput = document.getElementById("colmapInput")
	colmapInput.max = colourMap.length
}

function changePalette() {
	if (!this.validity.valid) { return }

	const palVal = parseInt(this.value)

	if (!colourPalette[palVal] || palVal === currentPalette) { return }

	currentPalette = palVal

	readImage(directory[dirList[dirList.selectedIndex].value])
}

function changeColmap() {
	if (!this.validity.valid) { return }

	const colmapVal = parseInt(this.value)

	if (!colourMap[colmapVal] || colmapVal === currentPalette) { return }

	currentColMap = colmapVal

	readImage(directory[dirList[dirList.selectedIndex].value])
}


function getTrimmedString(offset, max = 8) {
	let inc = 0
	while (wadData[offset + inc] > 0 && inc < max) {
		inc++
	}
	if (inc === 0) {
		return "error"
	}
	return textDecoder.decode(wadData.slice(offset, offset + inc))
}


function startLoadingFile(file) {
	if (!file || !FileReader) {
		console.warn("Missing input file, or FileReader functionality")
	}

	let fR = new FileReader()

	fR.addEventListener("load", () => {
		wadData = new Uint8Array(fR.result)
		readWAD()
	})

	fR.readAsArrayBuffer(file)
}

function loadFromFilePicker() {
	if (!this.files || !this.files[0]) { return }
	
	startLoadingFile(this.files[0])
}

function handleDrop(e) {
	noEvent(e)

	let dt = e.dataTransfer
	let file = dt.files[0]

	startLoadingFile(file)
}

function noEvent(e) {
	e.stopPropagation()
	e.preventDefault()
}

let visualOk = true
function visualDrag(e) {
	if (e.currentTarget !== document.body) { return }
	if (!visualOk) { return }
	if (e.type === "dragenter" || e.type === "drag") {
		if (!document.body.classList.contains("dragOver")) {
			document.body.classList.add("dragOver")
			visualOk = false
			setTimeout(() => { visualOk = true }, 16)
		}
	} else if (document.body.classList.contains("dragOver")) {
		document.body.classList.remove("dragOver")
	}
}


function buildEle(tag, info = false) {
	//info is an object that can contain { attr, style, events, textContent, children }
	let tmpEle = document.createElement(tag)
	if (!info) { return tmpEle }

	if (typeof info.attr === "object") {
		for (let [key, value] of Object.entries(info.attr)) {
			tmpEle.setAttribute(key, value)
		}
	}
	if (typeof info.style === "object") {
		for (let [key, value] of Object.entries(info.style)) {
			tmpEle.style.setProperty(key, value)
		}
	}
	if (typeof info.events === "object") {
		for (let [key, value] of Object.entries(info.events)) {
			tmpEle.addEventListener(key, value)
		}
	}
	if (typeof info.textContent === "string") {
		tmpEle.textContent = info.textContent
	}
	if (typeof info.children === "object") {
		info.children.forEach(c => tmpEle.appendChild(c))
	}
	return tmpEle
}

const textEles = (text) => {
	return text.split("\n").map(line => {
		const tmpEle = document.createElement("p")
		tmpEle.textContent = line
		return tmpEle
	})
}
