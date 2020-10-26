import fs from 'fs'
import googleStorage from '@google-cloud/storage'
const { Storage } = googleStorage
const storage = new Storage({ keyFilename: './config/google-service-account.json' })

const paidImagesBucketName = 'paid-images'
const comicsBucketName = 'yiffer-comics'

export default class FileSystemFacade {
	static async writeGooglePaidImageFile(localFilePath, newFilename) {
		await storage.bucket(paidImagesBucketName).upload(localFilePath, {
			destination: newFilename,
      gzip: true,
			metadata: {
        // Enable long-lived HTTP caching headers
        // Use only if the contents of the file will never change
        // (If the contents will change, use cacheControl: 'no-cache')
        cacheControl: 'no-cache',
      },
		})
	}

	static async renameGooglePaidImageFile(oldFilename, newFilename) {
		await storage.bucket(paidImagesBucketName).file(oldFilename).rename(newFilename)
	}
	
	static async writeGoogleComicFile(localFilePath, comicName, filename) {
		await storage.bucket(comicsBucketName).upload(localFilePath, {
			destination: `comics/${comicName}/${filename}`,
      gzip: true,
			metadata: {
        // Enable long-lived HTTP caching headers
        // Use only if the contents of the file will never change
        // (If the contents will change, use cacheControl: 'no-cache')
        cacheControl: 'no-cache',
      },
		})
	}

	static async renameFile (oldFilename, newFilename, errorMessage='File system error: Error renaming') {
		return new Promise(async (resolve, reject) => {
			fs.rename(oldFilename, newFilename, err => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve({error: false}) }
			})
		})
	}

	static async listDir (pathToDirectory, errorMessage='File system error: Error listing content') {
		return new Promise(async (resolve, reject) => {
			fs.readdir(pathToDirectory, (err, files) => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve(files) }
			})
		})
	}

	static async createDirectory (pathToDirectory, errorMessage='File system error: Error creating directory') {
		return new Promise(async (resolve, reject) => {
			fs.mkdir(pathToDirectory, err => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve({error: false}) }
			})
		})
	}

	static async deleteDirectory (pathToDirectory) {
		return new Promise(async (resolve, reject) => {
			fs.rmdir(pathToDirectory, err => {
				if (err) { reject({error: err, message: 'Error deleting directory'}) }
				else { resolve({error: false}) }
			})
		})
	}

	static async readFile (filePath, errorMessage='File system error: Error reading file') {
		return new Promise(async (resolve, reject) => {
			fs.readFile(filePath, (err, fileContent) => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve(fileContent) }
			})
		})
	}

	static async writeFile (filePath, fileData, errorMessage='File system error: Error writing file') {
		return new Promise(async (resolve, reject) => {
			fs.writeFile(filePath, fileData, err => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve({error: false}) }
			})
		})
	}	
	
	static async deleteFile (filePath, errorMessage='File system error: Error deleting file') {
		return new Promise(async (resolve, reject) => {
			fs.unlink(filePath, err => {
				if (err) { reject({error: err, message: errorMessage}) }
				else { resolve({error: false}) }
			})
		})
	}
		
	static async deleteFiles (filePaths, errorMessage='File system error: Error deleting file') {
		return new Promise(async (resolve, reject) => {
			let promises = []
			for (let path of filePaths) {
				promises.push(
					fs.unlink(path, err => {
						if (err) { reject({error: err, message: errorMessage}) }
					})
				)
			}
			await Promise.all(promises)
			resolve({error: false})
		})
	}
}