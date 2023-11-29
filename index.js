let { Server } = require("socket.io");
require("dotenv").config();
const io = new Server();

const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

// const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const REDIS_URL = process.env.REDIS_URL || "redis://eduployment-prod.i5fb0j.ng.0001.mes1.cache.amazonaws.com:6379"
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

const fetchMsgClient = createClient({ url: REDIS_URL });
fetchMsgClient.connect()

async function saveMessageInRedis(userID, message) {
    const CONVERSATION_TTL = 5 * 60 * 1000 //5 mins
    const value = typeof message == 'string' ? message : JSON.stringify(message);
    const data = await fetchMsgClient
        .multi()
        .rPush(`messages:${userID}`, value)
        .expire(`messages:${userID}`, CONVERSATION_TTL)
        .exec();
    console.log('Response from redis save, ',  data)
    return data;
}

async function findMessagesForUser(userID) {
    try {
        let results = await fetchMsgClient.lRange(`messages:${userID}`, 0, -1);
        return results.map((result) => JSON.parse(result));
    } catch (error) {
        console.log('Error fetching Missing Evenets for this user :: ', error)
    }
}

async function sendMissedEvents(userID) {
    let events = await findMessagesForUser(userID);
    console.log('missing events results:: ', events);
    if (events.length) {
        // loop over the events and call the io emit function to emit 
        events.forEach((eventData)=>{
            io.to(userID).emit(eventData.event, eventData);
        })
    } else {
        console.log('No Missing Evenets for theis user :: ', userID)
    }
}

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    pubClient.GET('name').then(val => console.log('pubClient:: ', val));

    io.adapter(createAdapter(pubClient, subClient));

    //middleware to set the userid same as userid
    io.use(function (socket, next) {
        const socketId = socket.handshake.query.user_id;
        console.log('Setting socketId: ', socketId)
        socket.id = socketId;

        sendMissedEvents(socketId)
        next();
    });

    io.on("connection", (socket) => {
        console.log(`A client with socket id ${socket.id} connected!`);

        socket.on("disconnect", () => {
            console.log("Socket disconnected!", socket.id);
        });

        socket.on("server:message", async (data) => {
            console.log('Recieve message : ', JSON.stringify(data), ' ', socket.id)
            let targetClientId = data.toId;
            console.log('targetClientId: ', targetClientId)
            console.log('Socket id is conencted : ', !!io.sockets.sockets.get(targetClientId))
            // if (!!io.sockets.sockets.get(targetClientId)) {
            // }
            const eventData = {
                event: "client:message",
                message: "Message is sent by: " + socket.id,
                timestamp: new Date()
            }
            let offsetId = saveMessageInRedis(targetClientId, eventData)
            io.to(targetClientId).emit(eventData.event, eventData);

            const sockets = await io.fetchSockets();
            console.log(sockets.map(s=>s.id));

            // io.of('/').adapter.clients((error, clients) => {
            //     if (error) throw error;
            //     console.log('All connected socket IDs:', clients);
            // });
        
            // io.to(targetClientId).emit(eventData.event, { offsetId, message }); TODO
            // try {
            //     const responses = await io.timeout(10000).emitWithAck("some-event");
            //     console.log(responses); // one response per client
            //   } catch (e) {
            //     // some clients did not acknowledge the event in the given delay
            //   }

            // try {
            //     // const responses = await io.timeout(10000).emitWithAck("some-event");
            //     const responses =
            //         await io.timeout(10000).to(targetClientId)
            //             .emitWithAck("client:message", "Ack Message is sent by: " + socket.id);
            //     console.log('ack responses',responses); // one response per client
            // } catch (e) {
            //     console.log('ack error',e); // one response per client

            //     // some clients did not acknowledge the event in the given delay
            // }

        });
    });

    console.log('process.env.SOCKET_PORT::', process.env.SOCKET_PORT)
    io.listen(process.env.SOCKET_PORT);
    global.io = io;
    console.log('IO connected success');

});

//todo: to check w
