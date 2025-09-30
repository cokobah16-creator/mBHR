@@ .. @@
   const handleAdminSetup = async (e: React.FormEvent) => {
     e.preventDefault()
     
     if (adminSetupPin.length < 6 || adminSetupPin.length > 12) {
       setError('Admin Setup PIN must be 6-12 digits')
       return
     }
     
     if (!adminName.trim()) {
       setError('Admin name is required')
       return
     }
 
     setLoading(true)
     setError('')
 
     try {
       // Create admin user
-      const salt = await generateSalt()
-      const pinHash = await hashPin(adminSetupPin, salt)
+      const salt = newSaltB64()
+      const pinHash = await derivePinHash(adminSetupPin, salt)
       
       const adminUser: User = {
         id: generateId(),
         fullName: adminName.trim(),
         role: 'admin',
         pinHash,
-        pinSalt: saltToString(salt),
+        pinSalt: salt,
         createdAt: new Date(),
         updatedAt: new Date(),
         isActive: true
       }
       
       await db.users.add(adminUser)
       await db.settings.put({ key: 'adminSetupDone', value: 'true' })
       
       setShowAdminSetup(false)
       setAdminSetupPin('')
       setAdminName('')
       
     } catch (error) {
       console.error('Admin setup error:', error)
       setError('Failed to create admin user')
     } finally {
       setLoading(false)
     }
   }