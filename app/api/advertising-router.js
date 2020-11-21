import BaseRouter from './baseRouter.js'

import multer from 'multer'
import FileSystemFacade from '../fileSystemFacade.js'

var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now())
  }
})
var upload = multer({ storage: storage })

export default class AdvertisingRouter extends BaseRouter {
  constructor (app, databaseFacade) {
		super(app, databaseFacade)
		this.setupRoutes()
  }
  
  setupRoutes () {
    this.app.get ('/api/paid-images', this.authorizeAdmin.bind(this), (req, res) => this.getAllAds(req, res))
    this.app.get ('/api/paid-images-basic', (req, res) => this.getAdsForList(req, res))
    this.app.get ('/api/paid-images/me', this.authorizeUser.bind(this), (req, res) => this.getUserAds(req, res))
    this.app.post('/api/paid-images', this.authorizeUser.bind(this), upload.single('file'), (req, res) => this.createApplication(req, res))
    this.app.post('/api/paid-images/:adId', this.authorizeAdmin.bind(this), (req, res) => this.updateAd(req, res))
    this.app.post('/api/paid-images/:adId/correct', this.authorizeUser.bind(this), upload.single('file'), (req, res) => this.correctAd(req, res))
    this.app.post('/api/paid-images/:adId/toggle-renew', this.authorizeUser.bind(this), (req, res) => this.toggleAdRenewal(req, res))
    this.app.post('/api/paid-images-click', (req, res) => this.logAdClick(req, res))
  }

  async createApplication (req, res) {
    let [file, adType, adLink, adMainText, adSecondaryText, notes, user] = 
      [req.file, req.body.adType, req.body.adLink, req.body.adMainText, req.body.adSecondaryText, req.body.notes, this.getUser(req)]
    
    if (!user) { return this.returnError('Not logged in', res, null, null) }
    let {isValid, error} = this.checkApplicationValidity(file, adType, adLink, adMainText, adSecondaryText, notes)
    if (!isValid) { return res.json({error: error}) }

    let filetype = file.originalname.substring(file.originalname.length-3)

    try {
      let adId = await this.generateAdId()
      let price = getPrice(adType)
      let query = 'INSERT INTO advertisement (Id, AdType, Link, MainText, SecondaryText, Filetype, UserId, Price, AdvertiserNotes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      let queryParams = [adId, adType, adLink, adMainText, adSecondaryText, filetype, user.id, price, notes]

      await this.databaseFacade.execute(query, queryParams, 'Error adding application to database')

      let newFilename = `${adId}.${filetype}`
      await FileSystemFacade.writeGooglePaidImageFile(file.path, newFilename)

      res.json({success: true})
    }
		catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async generateAdId () {
    let allIdsQuery = 'SELECT id FROM advertisement'
    let ids = await this.databaseFacade.execute(allIdsQuery, null, 'Error fetching ad IDs')

    let isIdNew = false
    let newId
    while (!isIdNew) {
      newId = makeId(6)
      let doesIdExist = [...ids].includes(newId)
      isIdNew = ids.length===0 || !doesIdExist
    }

    return newId
  }

  checkApplicationValidity (file, adType, adLink, adMainText, adSecondaryText, notes, isCorrection=false) {
    if (!file && !isCorrection) {
      return {isValid: false, error: 'File missing'}
    }
    if (file && (!file.originalname.endsWith('jpg') && !file.originalname.endsWith('png') && !file.originalname.endsWith('gif'))) {
      return {isValid: false, error: 'Invalid file format (must be jpg/png/gif)'}
    }
    if (!isCorrection && !adTypes.includes(adType)) {
      return {isValid: false, error: 'Invalid ad type'}
    }
    if (!adLink) {
      return {isValid: false, error: 'Missing link'}
    }
    if (notes && notes.length > 255) {
      return {isValid: false, error: 'Notes too long (max 255)'}
    }
    if (adType.includes('card')) {
      if (!adMainText) {
        return {isValid: false, error: 'Missing fields'}
      }
      if (adMainText.length > 25 || (adSecondaryText && adSecondaryText.length > 40)) {
        return {isValid: false, error: 'Text too long'}
      }
    }

    return {isValid: true}
  }

  async getAdsBase (req, res, whereStatement, whereParams, isAdminRequest) {
    try {
      let query = `SELECT advertisement.Id AS id, AdType AS adType, Link AS link, MainText AS mainText, SecondaryText AS secondaryText, UserId AS userId, Username AS username, Status AS status, ApprovedDate AS approvedDate, Filetype AS filetype, Price AS price, ActivationDate AS activationDate, DeactivationDate AS deactivationDate, ApplicationDate AS applicationDate, AdvertiserNotes AS advertisreNotes, Clicks AS clicks ${isAdminRequest ? ', AdminNotes AS adminNotes' : ''} FROM advertisement INNER JOIN user ON (user.Id = advertisement.UserId) ${whereStatement} ORDER BY ApplicationDate DESC`
      let results = await this.databaseFacade.execute(query, whereParams, 'Error fetching ads')

      for (let result of results) {
        result.adTypeLong = getLongAdType(result.adType)
      }

      return results
    }
		catch (err) {
      return this.returnError(err.message, res, err.error, err)
		}
  }

  async getUserAds (req, res) {
    let user = this.getUser(req)
    if (!user || !user.id) {
      return this.returnError('Invalid user', res, null, null)
    }

    let results = await this.getAdsBase(req, res, 'WHERE UserId=?', [user.id], false)
    res.json(results)
  }

  async getAllAds (req, res) {
    let whereQueryString = ''
    let whereQueryParams = null
    let statuses = req.query.statuses
    if ((typeof statuses) === 'string') {
      statuses = [statuses]
    }

    if (statuses && statuses.length > 0) {
      whereQueryParams = statuses
      whereQueryString = 'WHERE Status = ?'
      for (let i=0; i<statuses.length-1; i++) {
        whereQueryString += ' OR Status = ?'
      }
    }

    let results = await this.getAdsBase(req, res, whereQueryString, whereQueryParams, true)
    res.json(results)
  }

  async getAdsForList (req, res) {
    try {
      let query = `SELECT advertisement.Id AS id, AdType AS adType, Link AS link, MainText AS mainText, SecondaryText AS secondaryText, Filetype AS filetype FROM advertisement WHERE Status='ACTIVE' OR Status = 'ACTIVE, RENEWAL PAID' OR Status = 'ACTIVE, AWAITING RENEWAL PAYMENT'`
      let results = await this.databaseFacade.execute(query, null, 'Error fetching ads')

      res.json(results)
    }
		catch (err) {
      return this.returnError(err.message, res, err.error, err)
		}
  }

  async getAdById (req, res, adId) {
    let ad = await this.getAdsBase(req, res, 'WHERE advertisement.Id=?', [adId], true)
    return ad[0]
  }

  async updateAd (req, res) {
    let [adId, price, status, activationDate, deactivationDate, adminNotes] = 
      [req.params.adId, req.body.price, req.body.status, req.body.activationDate, req.body.deactivationDate, req.body.adminNotes]
    
    let query = 'UPDATE advertisement SET Price=?, Status=?, ActivationDate=?, DeactivationDate=?, AdminNotes=? WHERE Id=?'
    let queryParams = [price, status, activationDate, deactivationDate, adminNotes, adId]

    try {
      await this.databaseFacade.execute(query, queryParams, 'Error updating ad')
      let updatedAd = await this.getAdById(req, res, adId)
      res.json({success: true, ad: updatedAd})
    }
    catch (err) {
      return this.returnError(err.message, res, err.error, err)
    }
  }

  async correctAd (req, res) {
    try {
      let [adId, link, mainText, secondaryText, file] = 
        [req.params.adId, req.body.link, req.body.mainText, req.body.secondaryText, req.file]

      let existingAd = await this.getAdById(req, res, adId)
      let user = this.getUser(req)
      if (existingAd.userId !== user.id) {
        return this.returnStatusError(401, res, 'User does not own given ad id')
      }

      let {isValid, error} = this.checkApplicationValidity(file, existingAd.adType, link, mainText, secondaryText, file, true)
      if (!isValid) { return res.json({error: error}) }
    
      let query, queryParams

      if (file) {
        let filetype = file.originalname.substring(file.originalname.length-3)
        query = 'UPDATE advertisement SET Status=?, Link=?, MainText=?, SecondaryText=?, Filetype=? WHERE Id=?'
        queryParams = [adStatuses.pending, link, mainText, secondaryText, filetype, adId]

        await FileSystemFacade.writeGooglePaidImageFile(file.path, `${adId}.${filetype}`)
  
      }
      else {
        query = 'UPDATE advertisement SET Status=?, Link=?, MainText=?, SecondaryText=? WHERE Id=?'
        queryParams = [adStatuses.pending, link, mainText, secondaryText, adId]
      }

      await this.databaseFacade.execute(query, queryParams, 'Error updating ad')

      let updatedAd = await this.getAdById(req, res, adId)
      res.json({success: true, ad: updatedAd})
    }
    catch (err) {
      return this.returnStatusError(500, res, err)
    }
  }

  async toggleAdRenewal (req, res) {
    try {
      let [adId, shouldRenew] = [req.params.adId, req.body.shouldRenew]

      let ad = await this.getAdById(req, res, adId)
      let user = this.getUser(req)
      if (ad.userId !== user.id) {
        return this.returnStatusError(401, res, 'User does not own given ad id')
      }
      
      let query, queryParams

      if (ad.status === 'ACTIVE' && shouldRenew) {
        query = 'UPDATE advertisement SET Status=? WHERE id=?'
        queryParams = [adStatuses.activeAwaitingRenewal, adId]
      }
      else if (ad.status === 'ACTIVE, AWAITING RENEWAL PAYMENT' && !shouldRenew) {
        query = 'UPDATE advertisement SET Status=? WHERE id=?'
        queryParams = [adStatuses.active, adId]
      }
      else {
        return this.returnError('Illegal action', res, null, null)
      }

      await this.databaseFacade.execute(query, queryParams, 'Error updating ad')

      res.json({success: true})
    }
		catch (err) {
      return this.returnStatusError(500, res, err)
		}
  }

  async logAdClick (req, res) {
    res.end()
    let adId = req.body.adId
    try {
      let query = 'UPDATE advertisement SET Clicks = Clicks + 1 WHERE Id = ?'
      await this.databaseFacade.execute(query, [adId], 'Error logging ad click')
    }
		catch (err) {
      console.error('Error updating ad clicks: ', err)
		}
  }
}

const adTypes = ['card2M', 'card4M', 'banner1M']
const adStatuses = {
  pending: 'PENDING',
  needsCorrection: 'NEEDS CORRECTION',
  awaitingPayment: 'AWAITING PAYMENT',
  activeSoon: 'ACTIVE SOON',
  active: 'ACTIVE',
  activeAwaitingRenewal: 'ACTIVE, AWAITING RENEWAL PAYMENT',
  activeRenewalPaid: 'ACTIVE, RENEWAL PAID',
  ended: 'ENDED',
  cancelled: 'CANCELLED',
}

function makeId (length) {
  var result           = ''
  var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  var charactersLength = characters.length
  for (let i = 0; i < length; i++) {
     result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

function getPrice (adType) {
  if (adType === 'card2M') { return 20 }
  if (adType === 'card4M') { return 30 }
  if (adType === 'banner1M') { return 17}
}

function getLongAdType (adType) {
  if (adType === 'card2M') { return 'Card, 2 months' }
  if (adType === 'card4M') { return 'Card, 4 months' }
  if (adType === 'banner1M') { return 'Wide, 1 month' }
}
