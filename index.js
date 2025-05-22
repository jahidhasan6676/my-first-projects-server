require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors([
  "http://localhost:5173/",
  "https://shopper-application-3cae2.web.app"
]));
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
    // // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("Shopper");
    const usersCollection = db.collection("users");
    const productsCollection = db.collection("products");
    const cartsCollection = db.collection("carts");
    const wishlistCollection = db.collection("wishlist");
    const paymentCollection = db.collection("payments");
    const blogsCollection = db.collection("blogs");
    const reviewCollection = db.collection("review");


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

    // seller product buy customer this order product get from database
    app.get("/new-orders/:email", verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const query = { 'ownerInfo.email': email };

      const products = await productsCollection.find(query).toArray();
      const productIds = products.map(product => product._id.toString());

      const orders = await paymentCollection.aggregate([
        {
          $match: {
            productIds: { $in: productIds },
            status: { $ne: "Delivered" }
          }
        },
        {
          $addFields: {
            productIds: {
              $map: {
                input: "$productIds",
                as: "productId",
                in: { $toObjectId: "$$productId" }
              }
            }
          }
        },
        {
          $lookup: {
            from: "products",
            localField: "productIds",
            foreignField: "_id",
            as: "productItems"
          }
        },
        {
          $project: {
            email: 1,
            name: 1,
            price: 1,
            transactionId: 1,
            status: 1,
            deliveryInfo: 1,
            payment: 1,
            method: 1,
            date: 1,
            "productItems.productName": 1,
          }
        }
      ]).toArray();
      res.send(orders);

    });

    // delivered order history
    app.get("/order-history/:email", verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const query = { 'ownerInfo.email': email };

      const products = await productsCollection.find(query).toArray();
      const productIds = products.map(product => product._id.toString());

      const orders = await paymentCollection.aggregate([
        {
          $match: {
            productIds: { $in: productIds },
            status: "Delivered"
          }
        },
        {
          $addFields: {
            productIds: {
              $map: {
                input: "$productIds",
                as: "productId",
                in: { $toObjectId: "$$productId" }
              }
            }
          }
        },
        {
          $lookup: {
            from: "products",
            localField: "productIds",
            foreignField: "_id",
            as: "productItems"
          }
        },
        {
          $project: {
            email: 1,
            name: 1,
            price: 1,
            transactionId: 1,
            status: 1,
            deliveryInfo: 1,
            payment: 1,
            method: 1,
            date: 1,
            "productItems.productName": 1,
          }
        }
      ]).toArray();

      res.send(orders);
    });


    // order product delivery update
    app.patch("/order-placed-update/:id", verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const orderPlaced = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status: orderPlaced?.newOrderPlaced }
      }
      const result = await paymentCollection.updateOne(query, updateDoc);
      res.send(result);
    })

    // seller total product,order,sales and profit count
    app.get("/seller-activity-count/:email", verifyToken, verifySeller, async (req, res) => {
      const sellerEmail = req.params.email;
      //console.log("Seller Email:", sellerEmail);

      try {
        // 1️⃣ Step 1: Total Products Count from productsCollection
        const totalProductCount = await productsCollection.countDocuments({
          "ownerInfo.email": sellerEmail
        });
        //console.log("totalProducts:", totalProductCount)

        // 2️⃣ Step 2: Aggregation on paymentsCollection
        const paymentStats = await paymentCollection.aggregate([
          {
            $unwind: "$productIds"
          },
          {
            $addFields: {
              productObjectId: { $toObjectId: "$productIds" }
            }
          },
          {
            $lookup: {
              from: "products",
              localField: "productObjectId",
              foreignField: "_id",
              as: "productDetails"
            }
          },
          {
            $unwind: "$productDetails"
          },
          {
            $match: {
              "productDetails.ownerInfo.email": sellerEmail
            }
          },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalSales: {
                $sum: {
                  $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0]
                }
              },
              totalProfit: { $sum: "$price" }
            }
          },
          {
            $project: {
              _id: 0,
              totalOrders: 1,
              totalSales: 1,
              totalProfit: 1
            }
          }
        ]).toArray();

        const stats = paymentStats[0] || {
          totalOrders: 0,
          totalSales: 0,
          totalProfit: 0
        };

        // 3️⃣ Final Result
        const result = {
          totalProducts: totalProductCount,
          totalOrders: stats.totalOrders,
          totalSales: stats.totalSales,
          totalProfit: stats.totalProfit
        };

        //console.log("Final Result:", result);
        res.send(result);

      } catch (error) {
        console.error("Error fetching seller stats:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // seller sales and order chat data
    app.get("/seller-chart-stats/:email", verifyToken, verifySeller, async (req, res) => {
      const sellerEmail = req.params.email;

      try {
        const stats = await paymentCollection.aggregate([
          {
            $unwind: "$productIds"
          },
          {
            $addFields: {
              productObjectId: { $toObjectId: "$productIds" }
            }
          },
          {
            $lookup: {
              from: "products",
              localField: "productObjectId",
              foreignField: "_id",
              as: "productDetails"
            }
          },
          {
            $unwind: "$productDetails"
          },
          {
            $match: {
              "productDetails.ownerInfo.email": sellerEmail
            }
          },
          {
            $addFields: {
              month: { $month: { $toDate: "$date" } },
              year: { $year: { $toDate: "$date" } }
            }
          },
          {
            $group: {
              _id: {
                month: "$month",
                year: "$year"
              },
              sales: {
                $sum: {
                  $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0]
                }
              },
              orders: {
                $sum: {
                  $cond: [{ $ne: ["$status", "Delivered"] }, 1, 0]
                }
              }
            }
          },
          {
            $sort: {
              "_id.year": 1,
              "_id.month": 1
            }
          },
          {
            $project: {
              _id: 0,
              name: {
                $concat: [
                  {
                    $arrayElemAt: [
                      [
                        "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
                      ],
                      "$_id.month"
                    ]
                  },
                  " ",
                  { $toString: "$_id.year" }
                ]
              },
              sales: 1,
              orders: 1
            }
          }
        ]).toArray();

        res.send(stats);

      } catch (error) {
        console.error("Error fetching monthly chart stats:", error);
        res.status(500).json({ message: "Server error" });
      }
    });




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

    // get all approve product
    app.get("/allProduct", async (req, res) => {
      try {
        const {
          manCategory = "all",
          min = 0,
          max = 1000,
          search = "",
          sort = "",
        } = req.query;

        const query = { status: "Approve" };

        // Category Filter
        if (manCategory !== "all") {
          query.manCategory = manCategory;
        }

        // Price Range Filter
        query.price = { $gte: parseFloat(min), $lte: parseFloat(max) };

        // Search Filter
        if (search) {
          query.productName = { $regex: search, $options: "i" };
        }

        // Sorting
        let sortQuery = {};
        if (sort === "price-low") {
          sortQuery.price = 1;
        } else if (sort === "price-high") {
          sortQuery.price = -1;
        }

        // Get filtered and sorted products
        const result = await productsCollection
          .find(query)
          .sort(sortQuery)
          .toArray();
        //console.log("data:",result)

        // Get total count for pagination
        const total = await productsCollection.countDocuments(query);
        //console.log("total",total)

        res.send({ products: result, total });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products", error: error.message });
      }
    });


    // get all approve product by id
    app.get("/allProduct/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.find(query).toArray();
      res.send(result)
    })

    // get latest 10 product
    app.get("/latest-product", async (req, res) => {
      const result = await productsCollection.find({ status: "Approve" }).sort({ date: -1 }).limit(10).toArray();
      res.send(result)
    })

    // customer product select cart item add database
    app.post("/cartItem", verifyToken, async (req, res) => {
      const productData = req.body;
      const result = await cartsCollection.insertOne(productData);
      res.send(result)
    })

    // cart item count by specific customer
    app.get("/count/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const cartCount = await cartsCollection.countDocuments(query);
      const wishCount = await wishlistCollection.countDocuments(query);

      res.send({ cartCount, wishCount })

    })

    // customer product select wish item add database
    app.post("/wishlistItem", verifyToken, async (req, res) => {
      const productData = req.body;
      const result = await wishlistCollection.insertOne(productData);
      res.send(result)
    })

    // specific customer wishlist product delete from database
    app.delete("/wishlistProduct-delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await wishlistCollection.deleteOne(query);
      res.send(result)
    })

    // get cart item from database by email
    app.get("/cart-product/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await cartsCollection.find(query).toArray();
      res.send(result)
    })

    // specific customer cart product delete from database
    app.delete("/cart-product-delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await cartsCollection.deleteOne(query);
      res.send(result)
    })

    // cart collection order quantity update
    app.patch("/cart-quantity-update/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { orderQuantity: data?.newQuantity }
      }
      const result = await cartsCollection.updateOne(query, updateDoc);
      res.send(result)
    })

    // get wishlist product by specific customer
    app.get("/wishlist/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await wishlistCollection.find(query).toArray();
      res.send(result)
    })

    // get successfully payment order data
    app.get("/order-list/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })

    // top sell product get from database
    app.get("/top-seller-product", async (req, res) => {

      const payments = await paymentCollection.find({ payment: "success" }).toArray();

      let productIdCounts = {};
      payments.forEach(payment => {
        payment.productIds.forEach(productId => {
          productIdCounts[productId] = (productIdCounts[productId] || 0) + 1;
        });
      });

      const sortedProductIds = Object.entries(productIdCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(item => item[0]);

      const topProducts = await productsCollection.find({
        _id: { $in: sortedProductIds.map(id => new ObjectId(id)) }
      }).toArray();
      res.json(topProducts);

    })

    // get latest 4 blog data from database
    app.get("/blog", async (req, res) => {
      const result = await blogsCollection.find().sort({ date: -1 }).limit(4).toArray();
      res.send(result)
    })

    // get all blog data from database
    app.get("/allBlog", async (req, res) => {
      const result = await blogsCollection.find().toArray();
      res.send(result)
    })

    // get specific blog data from database
    app.get("/allBlog/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.findOne(query);
      res.send(result)
    })

    // customer send review
    app.post("/review", verifyToken, async (req, res) => {
      const review = req.body;

      try {
        // 1. Insert review into reviewCollection
        const result = await reviewCollection.insertOne(review);

        // 2. For each product ID, update its rating count and average
        const productIds = review.productIds;

        for (const id of productIds) {
          const allReviews = await reviewCollection.find({ productIds: id }).toArray();

          const totalCount = allReviews.length;
          const totalSum = allReviews.reduce((sum, r) => sum + parseInt(r.rating), 0);
          const avgRating = totalSum / totalCount;

          await productsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                ratingCount: totalCount,
                averageRating: parseFloat(avgRating.toFixed(1))
              }
            }
          );
        }

        res.send(result);
      } catch (error) {
        console.error("Error posting review:", error);
        res.status(500).send({ message: "Something went wrong" });
      }
    });

    // review get from database
    app.get("/reviews/:productId", async (req, res) => {
      const productId = req.params.productId;
      const result = await reviewCollection.find({ productIds: productId }).toArray();
      res.send(result);
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

    // add blog
    app.post("/addBlog", verifyToken, verifyAdmin, async (req, res) => {
      const blog = req.body;
      console.log(blog)
      const result = await blogsCollection.insertOne(blog);
      res.send(result)
    })



    // payment intent
    app.post("/payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"]
      })

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    // payment info save database
    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      // delete each item from the cart
      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id))
        }
      }

      const deleteResult = await cartsCollection.deleteMany(query)

      res.send({ paymentResult, deleteResult });
    })


    // Send a ping to confirm a successful connection
    //await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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