import {models} from '../models'
import * as path from 'path'

const env = process.env.NODE_ENV || 'development';
const config = require(path.join(__dirname,'../../config/app.json'))[env]

// setup disk storage
var multer = require('multer')
var avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let dir = __dirname.includes('/dist/') ? path.join(__dirname,'..') : __dirname
    cb(null, dir + '/../../public/uploads')
  },
  filename: (req, file, cb) => {
    const mime = file.mimetype
    const extA = mime.split("/")
    const ext = extA[extA.length-1]
    if(req.body.chat_id){
      cb(null, `chat_${req.body.chat_id}_picture.${ext}`)
    } else {
      cb(null, `${req.body.contact_id}_profile_picture.${ext}`)
    }
  }
})
var avatarUpload = multer({ storage: avatarStorage })

const uploadFile = async (req, res) => {
  const { contact_id, chat_id } = req.body
  const { file } = req

  const photo_url = 
    config.node_http_protocol + 
    '://' +
    process.env.NODE_IP +
    '/static/uploads/' + 
    file.filename

  if(contact_id){
    const contact = await models.Contact.findOne({ where: { id: contact_id } })
    if(contact) contact.update({ photoUrl: photo_url })
  }

  if(chat_id){
    const chat = await models.Chat.findOne({ where: { id: chat_id } })
    if(chat) chat.update({ photoUrl: photo_url })
  }

  res.status(200)
  res.json({
    success: true, 
    contact_id: parseInt(contact_id||0),
    chat_id: parseInt(chat_id||0), 
    photo_url
  });
  res.end();
}

export {
  avatarUpload,
	uploadFile
}
