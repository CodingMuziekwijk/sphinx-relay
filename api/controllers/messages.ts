import {models} from '../models'
import { Op } from 'sequelize' 
import { indexBy } from 'underscore'
import { sendNotification } from '../hub'
import * as socket from '../utils/socket'
import * as jsonUtils from '../utils/json'
import * as helpers from '../helpers'
import { success } from '../utils/res'
import {sendConfirmation} from './confirmations'

const constants = require(__dirname + '/../../config/constants.json')

const getMessages = async (req, res) => {
	const dateToReturn = req.query.date;

	if (!dateToReturn) {
		return getAllMessages(req, res)
	}
	console.log(dateToReturn)
	const owner = await models.Contact.findOne({ where: { isOwner: true } })
	// const chatId = req.query.chat_id

	let newMessagesWhere = {
		date: { [Op.gte]: dateToReturn },
		[Op.or]: [
			{receiver: owner.id}, 
			{receiver: null}
		]
	}
	
	let confirmedMessagesWhere = {
		updated_at: { [Op.gte]: dateToReturn },
		status: constants.statuses.received,
		sender: owner.id
	}

	// if (chatId) {
	// 	newMessagesWhere.chat_id = chatId
	// 	confirmedMessagesWhere.chat_id = chatId
	// }

	const newMessages = await models.Message.findAll({ where: newMessagesWhere })
	const confirmedMessages = await models.Message.findAll({ where: confirmedMessagesWhere })

	const chatIds: number[] = []
	newMessages.forEach(m => {
		if(!chatIds.includes(m.chatId)) chatIds.push(m.chatId)
	})
	confirmedMessages.forEach(m => {
		if(!chatIds.includes(m.chatId)) chatIds.push(m.chatId)
	})

	let chats = chatIds.length > 0 ? await models.Chat.findAll({ where: {deleted:false, id: chatIds} }) : []
	const chatsById = indexBy(chats, 'id')

	res.json({
		success: true,
		response: {
			new_messages: newMessages.map(message => 
				jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
			),
			confirmed_messages: confirmedMessages.map(message => 
				jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
			)
		}
	});
	res.status(200)
	res.end()
}

const getAllMessages = async (req, res) => {
	const messages = await models.Message.findAll({ order: [['id', 'asc']] })
	const chatIds = messages.map(m => m.chatId)
	console.log('=> getAllMessages, chatIds',chatIds)
	let chats = chatIds.length > 0 ? await models.Chat.findAll({ where: {deleted:false, id: chatIds} }) : []
	const chatsById = indexBy(chats, 'id')

	success(res, {
		new_messages: messages.map(
			message => jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
		),
		confirmed_messages: []
	})
};

async function deleteMessage(req, res){
	const id = req.params.id
	await models.Message.destroy({ where: {id} })
	success(res, {id})
}

const sendMessage = async (req, res) => {
	// try {
	// 	schemas.message.validateSync(req.body)
	// } catch(e) {
	// 	return failure(res, e.message)
	// }
	const {
		contact_id,
		text,
		remote_text,
		chat_id,
		remote_text_map,
	} = req.body

	console.log('[sendMessage]',)

	var date = new Date();
	date.setMilliseconds(0)

  	const owner = await models.Contact.findOne({ where: { isOwner: true }})
  	const chat = await helpers.findOrCreateChat({
		chat_id,
		owner_id: owner.id,
		recipient_id: contact_id,
	})

	const remoteMessageContent = remote_text_map?JSON.stringify(remote_text_map) : remote_text
	const msg={
		chatId: chat.id,
		type: constants.message_types.message,
		sender: owner.id,
		date: date,
		messageContent: text,
		remoteMessageContent,
		status: constants.statuses.pending,
		createdAt: date,
		updatedAt: date
	}
	// console.log(msg)
	const message = await models.Message.create(msg)

	success(res, jsonUtils.messageToJson(message, chat))

	helpers.sendMessage({
		chat: chat,
		sender: owner,
		type: constants.message_types.message,
		message: {
			id: message.id,
			content: remote_text_map || remote_text || text
		}
	})
}

const receiveMessage = async (payload) => {
	console.log('received message', { payload })

	var date = new Date();
	date.setMilliseconds(0)

	const total_spent = 1
	const {owner, sender, chat, content, msg_id} = await helpers.parseReceiveParams(payload)
	if(!owner || !sender || !chat) {
		return console.log('=> no group chat!')
	}
	const text = content

	const message = await models.Message.create({
		chatId: chat.id,
		type: constants.message_types.message,
		asciiEncodedTotal: total_spent,
		sender: sender.id,
		date: date,
		messageContent: text,
		createdAt: date,
		updatedAt: date,
		status: constants.statuses.received
	})

	console.log('saved message', message.dataValues)

	socket.sendJson({
		type: 'message',
		response: jsonUtils.messageToJson(message, chat, sender)
	})

	sendNotification(chat, sender.alias, 'message')

	const theChat = {...chat.dataValues, contactIds:[sender.id]}
	sendConfirmation({ chat:theChat, sender: owner, msg_id })
}

const readMessages = async (req, res) => {
	const chat_id = req.params.chat_id;
	
	const owner = await models.Contact.findOne({ where: { isOwner: true }})

	models.Message.update({ seen: true }, {
		where: {
		  sender: {
			[Op.ne]: owner.id
		  },
		  chatId: chat_id
		}
	});

	success(res, {})
}

const clearMessages = (req, res) => {
	models.Message.destroy({ where: {}, truncate: true })

	success(res, {})
}

export {
  getMessages,
  sendMessage,
  receiveMessage,
  clearMessages,
  readMessages,
  deleteMessage
}