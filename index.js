require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wwm8j.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("Shopper");
    const usersCollection = db.collection("users")
    const productsCollection = db.collection("products")


    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_ACCESS_TOKEN, {
        expiresIn: "10h"
      });
      res.send({ token })
    })

    // middleware

    // verify token middleware
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(403).send({ message: "unauthorized access" })
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.JWT_ACCESS_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(403).send({ message: "unauthorized access" })
        }
        req.decoded = decoded;
        next();
      })
    }

    //  verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden! Admin access required' })
      }
      next();
    }

    // verify moderator middleware
    const verifyModerator = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== 'moderator') {
        return res.status(403).send({ message: 'Forbidden! Moderator access required' })
      }
      next();
    }
    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== 'seller') {
        return res.status(403).send({ message: 'Forbidden! Seller access required' })
      }
      next();
    }


    // users api

    app.post("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      // check user already save in database
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({ ...user, role: "customer", timestamp: Date.now() })
      res.send(result)

    });

    // get user role from database
    app.get('/user/role/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role })

    });

    // seller work

    // store products in database
    app.post("/product", verifyToken, verifySeller, async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result)
    })

    // get all product data from database 
    app.get("/products", verifyToken, verifySeller, async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result)
    })
    // get database product by id
    app.get("/products/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result)
    })

    // get specific data get database by email
    app.get("/products/emailed/:email", verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const query = { "ownerInfo.email": email };
      const result = await productsCollection.find(query).toArray();
      res.send(result)
    })

    // single product delete database and UI
    app.delete("/product/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result)
    })

    // single product delete database and UI
    app.patch("/product-update/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          productName: data?.productName,
          manCategory: data?.manCategory,
          productCategory: data?.productCategory,
          description: data?.description,
          quantity: data?.quantity,
          price: data?.price,
          brandName: data?.brandName
        }
      }
      const result = await productsCollection.updateOne(query, updateDoc);
      res.send(result)
    })

    // moderator work

    // all pending product get from database
    app.get("/all-pending-product", verifyToken, verifyModerator, async (req, res) => {
      const result = await productsCollection.find({ status: "Pending" }).toArray();
      res.send(result)
    })

    // product status update
    app.patch("/product-update-status/:id", verifyToken, verifyModerator, async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { status: data?.status }
      }
      const result = await productsCollection.updateOne(query, updateDoc);
      res.send(result)
    })

    // all pending product get from database
    app.get("/all-approve-product", verifyToken, verifyModerator, async (req, res) => {
      const result = await productsCollection.find({ status: "Approve" }).toArray();
      res.send(result)
    })

    // all pending product get from database
    app.get("/all-reject-product", verifyToken, verifyModerator, async (req, res) => {
      const result = await productsCollection.find({ status: "Reject" }).toArray();
      res.send(result)
    })

    // customer work

    // men category data get from database
    app.get("/men-category-product", async (req, res) => {
      const result = await productsCollection.find({ manCategory: "Men", status: "Approve" }).toArray();
      res.send(result)
    })

    // admin work

    // admin get all users data from database
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } }
      const result = await usersCollection.find(query).toArray();
      res.send(result)
    })

    // admin update user role
    app.patch("/user-role/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const filter = { email }
      const updateDoc = {
        $set: { role }
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result)
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get("/", (req, res) => {
  res.send('shopper server is running');
});

app.listen(port, () => {
  console.log(`server port is: ${port}`)
})