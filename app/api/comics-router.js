let pythonShell = require('python-shell')
let multiparty = require('connect-multiparty')
let multipartyMiddelware = multiparty()
let FileSystemFacade = require('../fileSystemFacade')
let BaseRouter = require('./baseRouter')

module.exports = class ComicsRouter extends BaseRouter {
	constructor (app, databaseFacade) {
		super()
		this.app = app
		this.databaseFacade = databaseFacade
		this.setupRoutes()
	}

  setupRoutes () {
		this.app.get ('/api/comics', (req, res) => this.getComicList(req, res))
		this.app.get ('/api/comics/:name', (req, res) => this.getComicByName(req, res))
		this.app.post('/api/comics', multipartyMiddelware, (req, res) => this.createComic(req, res))
		this.app.post('/api/comics/:id/addpages', multipartyMiddelware, (req, res) => this.addPagesToComic(req, res, isPendingComic=false))
		this.app.post('/api/comics/:id/updatedetails', (req, res) => this.updateComicDetails(req, res))
		
		this.app.get ('/api/pendingcomics', (req, res) => this.getPendingComics(req, res))
		this.app.get ('/api/pendingcomics/:name', (req, res) => this.getPendingComic(req, res))
		this.app.post('/api/pendingcomics/:id', authorizeAdmin, (req, res) => this.processPendingComic(req, res))
		this.app.post('/api/pendingcomics/:id/addthumbnail', multipartyMiddelware, (req, res) => this.addThumbnailToPendingComic(req, res))
		this.app.post('/api/pendingcomics/:id/addkeywords', (req, res) => this.addKeywordsToPendingComic(req, res))
		this.app.post('/api/pendingcomics/:id/removekeywords', (req, res) => this.removeKeywordsFromPendingComic(req, res))
		this.app.post('/api/pendingcomics/:id/addpages', multipartyMiddelware, (req, res) => this.addPagesToComic(req, res, isPendingComic=true))
	}
	
	async getComicList (req, res) {
		let query
		let queryParams
		let user = this.getUser(req)
		if (user) {
			query = 'SELECT T1.ComicId AS id, T1.ComicName AS name, T1.Cat AS cat, T1.Tag AS tag, T1.ArtistName AS artist, T1.Updated AS updated, T1.Created AS created, T1.Finished AS finished, T1.NumberOfPages AS numberOfPages, T1.Snitt AS userRating, T2.YourVote AS yourRating, T3.Keywords AS keywords FROM (( SELECT Comic.Id AS ComicId, Comic.Name AS ComicName, Cat, Artist.Name as ArtistName, Tag, Updated, Created, Finished, NumberOfPages, AVG(Vote) AS Snitt FROM Comic INNER JOIN Artist ON (Artist.Id = Comic.Artist) LEFT JOIN ComicVote ON (Comic.Id = ComicVote.ComicId) GROUP BY Comic.Name, Comic.Id) AS T1 LEFT JOIN (SELECT ComicKeyword.ComicId AS ComicId, GROUP_CONCAT(Keyword SEPARATOR \',\') AS Keywords FROM ComicKeyword GROUP BY ComicKeyword.ComicId) AS T3 ON (T1.ComicId = T3.ComicId) LEFT JOIN (SELECT ComicId, Vote AS YourVote FROM ComicVote WHERE Username = ?) AS T2 ON (T1.ComicId = T2.ComicId)) ORDER BY id' 
			queryParams = [user.username]
		}
		else {
			query = 'SELECT Comic.Id AS id, Comic.Name AS name, Comic.Cat AS cat, Comic.Tag AS tag, Artist.Name AS artist, Comic.Updated AS updated, Comic.Finished AS finished, Comic.Created AS created, Comic.NumberOfPages AS numberOfPages, AVG(ComicVote.Vote) AS userRating, 0 AS yourRating, T1.Keywords AS keywords FROM Comic INNER JOIN Artist ON (Artist.Id = Comic.Artist) LEFT JOIN (SELECT ComicKeyword.ComicId AS ComicId, GROUP_CONCAT(Keyword SEPARATOR \',\') AS Keywords FROM ComicKeyword GROUP BY ComicKeyword.ComicId) AS T1 ON (T1.ComicId = Comic.Id) LEFT JOIN ComicVote ON (Comic.Id = ComicVote.ComicId) GROUP BY name, id ORDER BY id'
		}

		try {
			let results = await this.databaseFacade.execute(query, queryParams)
			results = results.map(comic => {
				comic.keywords = !comic.keywords ? [] : comic.keywords.split(',')
				return comic
			})
			res.json(results)
		}
		catch (err) {
      return this.returnError(err.message, res, err.error)
		}
	}

	async getComicByName (req, res) {
    let comicName = req.params.name
    let comicDataQuery
		let queryParams = []
    let prevLinkQuery = 'SELECT Name FROM ComicLink INNER JOIN Comic ON (Id = FirstComic) WHERE LastComic = ?'
    let nextLinkQuery = 'SELECT Name FROM ComicLink INNER JOIN Comic ON (Id = LastComic) WHERE FirstComic = ?'
		let user = this.getUser(req)

		if (user) {
			comicDataQuery = 'SELECT T1.ComicId AS id, T1.ComicName AS name, T1.Cat AS cat, T1.Tag AS tag, T1.ArtistName AS artist, T1.Updated AS updated, T1.Created AS created, T1.Finished AS finished, T1.NumberOfPages AS numberOfPages, T1.Snitt AS userRating, T2.YourVote AS yourRating, T3.Keywords AS keywords FROM ((SELECT Comic.Id AS ComicId, Comic.Name AS ComicName, Cat, Artist.Name as ArtistName, Tag, Updated, Created, Finished, NumberOfPages, AVG(Vote) AS Snitt FROM Comic INNER JOIN Artist ON (Artist.Id = Comic.Artist) LEFT JOIN ComicVote ON (Comic.Id = ComicVote.ComicId) GROUP BY Comic.Name, Comic.Id) AS T1 LEFT JOIN (SELECT ComicKeyword.ComicId, GROUP_CONCAT(Keyword SEPARATOR \',\') AS Keywords FROM ComicKeyword WHERE ComicKeyword.ComicId = (SELECT Comic.Id FROM Comic WHERE Comic.Name = ?)) AS T3 ON (T1.ComicId = T3.ComicId) LEFT JOIN (SELECT ComicId, Vote AS YourVote FROM ComicVote WHERE Username = ?) AS T2 ON (T1.ComicId = T2.ComicId)) WHERE T1.ComicName = ?'
			queryParams = [comicName, user.username, comicName]
		}
		else {
			comicDataQuery = 'SELECT Comic.Name AS name, NumberOfPages as numberOfPages, Artist.Name AS artist, Comic.Id AS id, NULL AS yourRating, AVG(ComicVote.Vote) AS userRating, T1.Keywords AS keywords FROM Comic INNER JOIN Artist ON (Artist.Id = Comic.Artist) LEFT JOIN (SELECT ComicKeyword.ComicId, GROUP_CONCAT(Keyword SEPARATOR \',\') AS Keywords FROM ComicKeyword WHERE ComicKeyword.ComicId = (SELECT Comic.Id FROM Comic WHERE Comic.Name = ?)) AS T1 ON (T1.ComicId = Comic.Id) LEFT JOIN ComicVote ON (Comic.Id = ComicVote.ComicId) WHERE Comic.Name = ?'
			queryParams = [comicName, comicName]
		}

		try {
			let result = await this.databaseFacade.execute(comicDataQuery, queryParams)
			let comicData = result[0]
			if (!comicData) { return this.returnError('Comic not found', res) }
			
			let comicId = comicData.id
			if (!comicData.keywords) { comicData.keywords = [] }
			else { comicData.keywords = comicData.keywords.split(',') }
			comicData.previousComic = null
			comicData.nextComic = null

			let prevLink = await this.databaseFacade.execute(prevLinkQuery, [comicId])
			if (prevLink.length > 0) { comicData.previousComic = prevLink[0].Name }
			let nextLink = await this.databaseFacade.execute(nextLinkQuery, [comicId])
			if (nextLink.length > 0) { comicData.nextComic = nextLink[0].Name }

			res.json(comicData)
		}
		catch (err) {
      return this.returnError(err.message, res, err.error)
		}
	}

	async createComic (req, res) {
		if (!this.authorizeMod(req)) {
			return this.returnError('Unauthorized', res)
		}
		let [newFiles, thumbnailFile] = [req.files.pageFile, req.files.thumbnailFile]
		let [comicName, artistId, cat, tag, isFinished, keywords] = 
			[req.body.comicName, Number(req.body.artistId), req.body.cat, 
				req.body.tag,req.body.finished==='true', req.body.keywords]
		let userId = req.session.user.id
		let comicFolderPath = __dirname + '/../../../client/public/comics/' + comicName
		let hasThumbnail = !!thumbnailFile

		if (!newFiles) { return this.returnError('No files added', res) }
		if (newFiles.hasOwnProperty('fieldName')) { return this.returnError('Comic must have more than one page', res) }
		let fileList = this.sortNewComicImages(newFiles)

		try {
			let allComicFoldersList = await FileSystemFacade.listDir(__dirname + '/../../../client/public/comics', 'Error reading comics directory')
			if (allComicFoldersList.indexOf(comicName) >= 0) {
				return this.returnError('Directory of a comic with this name already exists', res)
			}

			let result = await this.writeNewComicFiles(fileList, comicFolderPath, thumbnailFile)
			if (result.error) { return this.returnError(result.error, res) }

			let insertQuery = 'INSERT INTO PendingComic (ModUser, Name, Artist, Cat, Tag, NumberOfPages, Finished, HasThumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			let insertQueryParams = [userId, comicName, artistId, cat, tag, fileList.length, isFinished, hasThumbnail?1:0]
			let insertResult = await this.databaseFacade.execute(insertQuery, insertQueryParams, 'Database error creating new comic')
			let comicId = insertResult.insertId

			await this.addKeywordsToComic(keywords, comicId)

			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}
	
	async writeNewComicFiles (fileList, comicFolderPath, thumbnailFile) {
		await FileSystemFacade.createDirectory(comicFolderPath)
		for (var i=1; i<= fileList.length; i++) {
			let file = fileList[i-1]
			let fileContents = await FileSystemFacade.readFile(file.path)
			let pageName = this.getPageName(i, file.path)
			if (!pageName) { 
				return {error: 'Some file is not .jpg or .png!'}
			}
			await FileSystemFacade.writeFile(comicFolderPath + '/' + pageName, fileContents, 'Error writing a new file to disk')
		}
		if (!!thumbnailFile) {
			let fileContents = await FileSystemFacade.readFile(thumbnailFile.path)
			await FileSystemFacade.writeFile(comicFolderPath + '/s.jpg', fileContents, 'Error writing thumbnail file to disk')
		}
	
		await pythonShell.PythonShell.run('process_new_comic.py', {mode: 'text', args: [req.body.comicName], scriptPath: 'C:/scripts/Server/app'})
		return {error: false}
	}

	async addKeywordsToComic(commaSeparatedKeywordString, comicId) {
		let insertKeywordsQuery = 'INSERT INTO PendingComicKeyword (ComicId, Keyword) VALUES '
		let insertKeywordsParams = []
		for (var keyword of commaSeparatedKeywordString.split(',')) {
			insertKeywordsQuery += `(?, ?), `
			insertKeywordsParams.push(comicId)
			insertKeywordsParams.push(keyword)
		}
		insertKeywordsQuery = insertKeywordsQuery.substring(0, insertKeywordsQuery.length-2)
		await this.databaseFacade.execute(insertKeywordsQuery, insertKeywordsQueryParams, 'Database error adding tags')
	}

	async addPagesToComic (req, res, isPendingComic) {
		let [comicName, comicId] = [req.body.comicName, req.params.id]
		let comicFolderPath = __dirname + '/../../../client/public/comics/' + comicName
		if (!req.files || !req.files.newPages) { return this.returnError('No files added!', res) }
		let requestFiles = req.files.newPages

		try {
			let existingFiles = await this.FileSystemFacade.readdir(comicFolderPath)
			let existingNumberOfPages = existingFiles.filter(f => f != 's.jpg').length

			let newFilesWithNames = this.parseRequestFiles(requestFiles, existingNumberOfPages)

			await this.writeAppendedComicPageFiles(comicFolderPath, newFilesWithNames)
			
			// todo python facade
			await pythonShell.PythonShell.run('process_new_pages.py',
				{mode: 'text', args: [comicName, newFilesWithNames.length],
				scriptPath: 'C:/scripts/Server/app'})

			let updateNumberOfPagesQuery = `UPDATE ${isPendingComic ? 'PendingComic' : 'Comic'} SET NumberOfPages = ? WHERE Id = ?`
			let queryParams = [existingNumberOfPages + newFilesWithNames.length, comicId]
			await this.databaseFacade.execute(updateNumberOfPagesQuery,
				queryParams, 'Database error: Error updating number of pages')
			
			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	parseRequestFiles (requestFiles, existingNumberOfPages) {
		if (this.isOneFileOnly(requestFiles)) {
			return [{
				filename: this.getPageName(existingNumberOfPages+1, requestFiles.path),
				file: requestFiles
			}]
		}
		else {
			requestFiles = [...requestFiles].sort()
			return requestFiles.map((file, i) => ({
				filename: this.getPageName(existingNumberOfPages+i+1, file.path),
				file: file
			}))
		}
	}

	async writeAppendedComicPageFiles (comicFolderPath, fileList) {
		for (let file of fileList) {
			let fileData = await this.FileSystemFacade.readFile(file.file.path,
				`Error parsing uploaded file (${file.name})`) // todo make sure this is  filename
			await this.FileSystemFacade.writeFile(`${comicFolderPath}/${file.filename}`,
				fileData, `Error writing file to disc (${file.name})`) // todo make sure this is  filename
		}
	}

	async updateComicDetails (req, res) {
		let [comicId, oldName, newName, newCat, newTag, newFinished, newArtistName] = 
			[req.params.id, req.body.oldName, req.body.name, req.body.cat, req.body.tag, req.body.finished, req.body.artist]

		if (!newName || !newCat || !newTag || newFinished==undefined || !newArtistName) {
			return returnError('Missing fields', res, null, null)
		}

		try {
			if (oldName !== newName) {
				await FileSystemFacade.renameFile(
					`${__dirname}/../../../client/public/comics/${oldName}`,
					`${__dirname}/../../../client/public/comics/${newName}`,
					'Error renaming comic directory')
			}

			let query = 'UPDATE Comic SET Name = ?, Cat = ?, Tag = ?, Finished = ?, Artist = (SELECT Artist.Id FROM Artist WHERE Name = ?) WHERE Id = ?'
			let queryParams = [newName, newCat, newTag, newFinished, newArtistName, comicId]
			await this.databaseFacade.execute(query, queryParams)
			res.json({success: true})
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async getPendingComics (req, res) {
		let query = 'SELECT Artist.Name AS artist, PendingComic.Id AS id, PendingComic.Name AS name, ModName AS modName, Cat AS cat, Tag AS tag, NumberOfPages AS numberOfPages, Finished AS finished, HasThumbnail AS hasThumbnail, T3.Keywords AS keywords FROM PendingComic INNER JOIN Artist ON (PendingComic.Artist=Artist.Id) LEFT JOIN (SELECT PendingComicKeyword.ComicId AS ComicId, GROUP_CONCAT(Keyword SEPARATOR \',\') AS Keywords FROM PendingComicKeyword GROUP BY PendingComicKeyword.ComicId) AS T3 ON (T3.ComicId=PendingComic.Id) WHERE Processed=0'
		try {
			let comics = this.databaseFacade.execute(query)
			for (let comic of comics) {
				if (!comic.keywords) { comic.keywords = [] }
				else { comic.keywords = comic.keywords.split(',') }
			}
			res.json(comics)
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}

	async getPendingComic (req, res) {
		let comicName = req.params.name
		let comicDataQuery = 'SELECT Artist.Name AS artistName, PendingComic.Id AS id, PendingComic.Name AS name, Cat AS cat, Tag AS tag, NumberOfPages AS numberOfPages, Finished AS finished, HasThumbnail AS hasThumbnail FROM PendingComic INNER JOIN Artist ON (PendingComic.Artist=Artist.Id) WHERE PendingComic.Name = ?'
		let keywordsQuery = 'SELECT Keyword FROM PendingComicKeyword WHERE ComicId = ?'
		try {
			let comicData = await this.databaseFacade.execute(comicDataQuery, [comicName])
			if (results.length === 0) { return this.returnError('No pending comic with that name', res) }
			comicData = comicData[0]

			let keywords = await this.databaseFacade.execute(keywordsQuery, [comicData.id])
			comicData.keywords = keywords.map(k => k.Keyword)

			res.json(comicData)
		}
		catch (err) {
			return this.returnError(err.message, res, err.error)
		}
	}


	sortNewComicImages (requestFiles) {
		return [...requestFiles].sort((file1, file2) => file1.name>file2.name ? 1 : -1)
	}

	getPageName (pageNumber, filePathName) {
		let pageNumberString = (pageNumber < 10) ? ('0' + pageNumber) : (pageNumber)
		let pagePostfix = filePathName.substring(filePathName.length - 4)
		if (pagePostfix != '.jpg' && pagePostfix != '.png') { return false }
		return pageNumberString + pagePostfix
	}

	isOneFileOnly (requestFilesObject) {
		return requestFilesObject.hasOwnProperty('fieldname')
	}
}

module.exports = function (app, mysqlPool) {


	function processPendingComic (req, res, next) {
		let comicId = req.params.id
		let getFullPendingComicDataQuery = 'SELECT Name, Cat, Tag, NumberOfPages, Finished, Artist, HasThumbnail FROM PendingComic WHERE Id = ?'
		let getKeywordsQuery = 'SELECT Keyword FROM PendingComicKeyword WHERE ComicId = ?'
		let updatePendingComicsQuery = 'UPDATE PendingComic SET Processed = 1, Approved = 1 WHERE Id = ?'
		let insertIntoComicQuery = 'INSERT INTO Comic (Name, Cat, Tag, NumberOfPages, Finished, Artist) VALUES (?, ?, ?, ?, ?, ?)'
		let insertKeywordsQuery = 'INSERT INTO ComicKeyword (ComicId, Keyword) VALUES '
		mysqlPool.getConnection((err, connection) => {
			connection.query(getFullPendingComicDataQuery, [comicId], (err, results) => {
				if (err) { return returnError('Database error: Error getting the pending comic\'s data', res, connection, err) }
				let comicData = results[0]
				if (!!comicData.hasThumbnail) { return returnError('Pending comic has no thumbnail', res, connection, err) }

				connection.query(getKeywordsQuery, [comicId], (err, results) => {
					if (err) { return returnError('Database error: Error getting tags from pending comic', res, connection, err) }
					if (results.length === 0) { return returnError('No tags added', res, connection, err) }
					let keywords = results.map(keywordObj => keywordObj.Keyword)
					let updatePendingComicsQueryParams = [comicData.Name, comicData.Cat, comicData.Tag, comicData.NumberOfPages, comicData.Finished, comicData.Artist]
					connection.query(insertIntoComicQuery, updatePendingComicsQueryParams, (err, results) => {
						if (err) { return returnError('Database error: Error adding new comic to the database', res, connection, err) }
						let newComicId = results.insertId
						
						connection.query(updatePendingComicsQuery, [comicId], (err, results) => {
							if (err) { return returnError('Database error: Error updating pending comic processed status', res, connection, err) }	

							let insertKeywordsQueryParams = []
							for (var keyword of keywords) { 
								insertKeywordsQuery += `(?, ?), `
								insertKeywordsQueryParams.push(newComicId)
								insertKeywordsQueryParams.push(keyword)
							}
							insertKeywordsQuery = insertKeywordsQuery.substring(0, insertKeywordsQuery.length-2)
							connection.query(insertKeywordsQuery, insertKeywordsQueryParams, (err, results) => {
								if (err) { return returnError('Database error: Error transferring tags from pending to new comic', res, connection, err) }	

								res.json({success: true})
								connection.release()
							})
						})
					})
				})
			})
		})
	}


	async function addThumbnailToPendingComic (req, res, next) {
		let thumbnailFile = req.files.thumbnailFile
		let comicName = req.body.comicName
		let comicId = req.params.id
		let comicFolderPath = `${__dirname}/../../../client/public/comics/${comicName}`

		if (!thumbnailFile || (thumbnailFile.path.indexOf('.jpg')===-1 && thumbnailFile.path.indexOf('.png')===-1)) {
			return returnError('File must exist and be .jpg or .png', res, null, null)
		}

		try {
			let directoryContents = fs.readdirSync(comicFolderPath)
			if (directoryContents.indexOf('s.jpg') >= 0) {
				fs.unlinkSync(comicFolderPath + '/s.jpg')
			}
			let fileContents = fs.readFileSync(thumbnailFile.path)
			await fs.writeFileSync(comicFolderPath+'/s.jpg', fileContents)
		}
		catch (err) {
			return returnError('Error deleting old thumbnail or writing new one to disc', res, null, err)
		}

		let updateComicDataQuery = 'UPDATE PendingComic SET HasThumbnail = 1 WHERE Id = ?'
		mysqlPool.getConnection((err, connection) => {
			connection.query(updateComicDataQuery, [comicId], (err) => {
				if (err) { return returnError('Error updating comic data to reflect new thumbnail added', res, connection, err) }
				res.json({success: true})
				connection.release()
			})
		})
	}

	
	function addKeywordsToPendingComic (req, res, next) {
		let comicId = req.params.id
		let addKeywordsQuery = 'INSERT INTO PendingComicKeyword (ComicId, Keyword) VALUES '
		let addKeywordsQueryParams = []
		for (var keyword of req.body.keywords) {
			addKeywordsQuery += '(?, ?), '
			addKeywordsQueryParams.push(comicId)
			addKeywordsQueryParams.push(keyword)
		}
		addKeywordsQuery = addKeywordsQuery.substring(0, addKeywordsQuery.length-2)

		mysqlPool.getConnection((err, connection) => {
			connection.query(addKeywordsQuery, addKeywordsQueryParams, (err) => {
				if (err) { return returnError('Error inserting the keywords into the database', res, connection, err) }
				res.json({success: true})
				connection.release()
			})
		})
	}


	function removeKeywordsFromPendingComic (req, res, next) {
		let comicId = req.params.id
		let removeKeywordsQuery = 'DELETE FROM PendingComicKeyword WHERE (ComicId, Keyword) IN ('
		let removeKeywordsQueryParams = []
		for (var keyword of req.body.keywords) {
			removeKeywordsQuery += '(?, ?), '
			removeKeywordsQueryParams.push(comicId)
			removeKeywordsQueryParams.push(keyword)
		}
		removeKeywordsQuery = removeKeywordsQuery.substring(0, removeKeywordsQuery.length-2) + ')'

		mysqlPool.getConnection((err, connection) => {
			connection.query(removeKeywordsQuery, removeKeywordsQueryParams, (err) => {
				if (err) { return returnError('Error removing the keywords from the database', res, connection, err) }
				res.json({success: true})
				connection.release()
			})
		})
	}




}


function renameComic (oldComicName, newComicName) {
	return new Promise(resolve => {
		fs.rename(`${__dirname}/../../../client/public/comics/${oldComicName}`, `${__dirname}/../../../client/public/comics/${newComicName}`, (err) => {
			if (err) { resolve({success: false, error: err}) }
			else { resolve({success: true}) }
		})
	})
}


async function parseAndWriteNewFiles (comicFolderPath, requestFiles) {
	return new Promise( async resolve => {
		fs.readdir(comicFolderPath, (err, files) => {
			let oldNumberOfPages = files.filter(f => f!='s.jpg').length
			let newFilesWithNames = []
			if (requestFiles.hasOwnProperty('fieldName')) { // one file only
				newFilesWithNames.push({filename: getPageName(oldNumberOfPages+1, requestFiles.path), file: requestFiles})
			}
			else {
				requestFiles = [...requestFiles].sort((f1, f2) => f1>f2 ? 1 : -1)
				for (var i=0; i<requestFiles.length; i++) {
					newFilesWithNames.push({filename: getPageName(oldNumberOfPages+i+1, requestFiles[i].path), file: requestFiles[i]})
				}
			}

			for (var newFile of newFilesWithNames) {
				fs.writeFileSync(`${comicFolderPath}/${newFile.filename}`, fs.readFileSync(newFile.file.path))
			}

			resolve([newFilesWithNames.length, oldNumberOfPages + newFilesWithNames.length])
		})
	})
}


function zipComic (comicName, isNewComic) {
  let zipFilePath = __dirname + '/../../public/021njnwjfusjkfn89c23nfsnfkas/' + comicName + '.zip'
  if (!isNewComic) {
    console.log('Deleting file ' + zipFilePath)
    fs.unlinkSync(zipFilePath)
  }

  let outputStream = fs.createWriteStream(zipFilePath)
  let archive = archiver('zip', {zlib: {level: 9}})

  archive.pipe(outputStream)
  archive.directory(__dirname + '/../../public/comics/'+ comicName +'/', false)
  archive.finalize()
  console.log('Zipping ' + comicName + '!')
}

function authorizeAdmin (req, res, next) { // todo !!
  if (!req.session || !req.session.user) { return false }
  if (authorizedUsers.admins.indexOf(req.session.user.username) === -1) { return false }
  next()
}


function authorizeMod (req) { // todo !! gj;re til next
  // if (!req.session || !req.session.user) { return false }
  // if (authorizedUsers.mods.indexOf(req.session.user.username) === -1) { return false }
  return true
}


function logComicUpdate (req, mysqlPool) {
  let comicName = req.body.comicName
  let modName = req.session.user.username
  let query = 'INSERT INTO TagLog (TagNames, ComicName, Username) VALUES (?, ?, ?)'
  mysqlPool.getConnection((err, connection) => {
    connection.query(query, ['>>ADD iMAGE<<', comicName, modName], (err, rows) => {
      if (err) { return returnError(null, null, connection, err) }
      connection.release()
    })
  })
}


function getPageName (pageNumber, filePathName) {
  let pageNumberString = (pageNumber < 10) ? ('0' + pageNumber) : (pageNumber)
  let pagePostfix = filePathName.substring(filePathName.length - 4)
  if (pagePostfix != '.jpg' && pagePostfix != '.png') { return false }
  return pageNumberString + pagePostfix
}


function sortNewComicImages (requestFiles) {
	return [...requestFiles].sort((file1, file2) => file1.name>file2.name ? 1 : -1)
}