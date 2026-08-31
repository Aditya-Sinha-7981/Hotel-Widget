https://pridehotel.thexoombox.in/API/department_list

{
    "status": true,
    "message": "Department list fetched successfully",
    "data": [
        {
            "department_id": "15",
            "department_name": "Rooms"
        },
        {
            "department_id": "16",
            "department_name": "Restaurant"
        },
        {
            "department_id": "17",
            "department_name": "Banquets"
        }
    ]
}

https://pridehotel.thexoombox.in/API/getCities

{
    "status": true,
    "message": "Cities fetched successfully",
    "data": [
        {
            "city_id": "28",
            "city_name": "Ahmedabad"
        },
        {
            "city_id": "31",
            "city_name": "Alwar"
        },
        {
            "city_id": "33",
            "city_name": "Becharaji"
        },
        {
            "city_id": "36",
            "city_name": "Bengaluru"
        },
        {
            "city_id": "39",
            "city_name": "Bharuch"
        },
        {
            "city_id": "22",
            "city_name": "Bhopal"
        },
        {
            "city_id": "47",
            "city_name": "Chhatrapati Sambhajinagar"
        },
        {
            "city_id": "50",
            "city_name": "Daman"
        },
        {
            "city_id": "52",
            "city_name": "Darjeeling"
        },
        {
            "city_id": "55",
            "city_name": "Dehradun"
        },
        {
            "city_id": "27",
            "city_name": "Delhi"
        },
        {
            "city_id": "58",
            "city_name": "Deoghar"
        },
        {
            "city_id": "60",
            "city_name": "Digha"
        },
        {
            "city_id": "29",
            "city_name": "Dwarka"
        },
        {
            "city_id": "32",
            "city_name": "Gandhinagar"
        },
        {
            "city_id": "34",
            "city_name": "Gir Forest"
        },
        {
            "city_id": "37",
            "city_name": "Goa"
        },
        {
            "city_id": "40",
            "city_name": "Greater Noida"
        },
        {
            "city_id": "42",
            "city_name": "Haldwani"
        },
        {
            "city_id": "45",
            "city_name": "Haridwar"
        },
        {
            "city_id": "48",
            "city_name": "Himmatnagar"
        },
        {
            "city_id": "8",
            "city_name": "Indore"
        },
        {
            "city_id": "53",
            "city_name": "Jaipur"
        },
        {
            "city_id": "56",
            "city_name": "Jodhpur"
        },
        {
            "city_id": "59",
            "city_name": "Kolkata"
        },
        {
            "city_id": "61",
            "city_name": "Mussoorie"
        },
        {
            "city_id": "30",
            "city_name": "Nagpur"
        },
        {
            "city_id": "35",
            "city_name": "Phaltan"
        },
        {
            "city_id": "38",
            "city_name": "Pune"
        },
        {
            "city_id": "41",
            "city_name": "Puri"
        },
        {
            "city_id": "12",
            "city_name": "Raipur"
        },
        {
            "city_id": "46",
            "city_name": "Rajkot"
        },
        {
            "city_id": "49",
            "city_name": "Rishikesh"
        },
        {
            "city_id": "51",
            "city_name": "Rudraprayag"
        },
        {
            "city_id": "54",
            "city_name": "Surat"
        },
        {
            "city_id": "14",
            "city_name": "Vadodara"
        }
    ]
}

https://pridehotel.thexoombox.in/API/getPropertyByCity

it needs an input, in postman, I gave Body -> raw -> JSON

{
  "city_id": 8
}

then the output was

{
    "status": true,
    "message": "Property list fetched successfully",
    "data": [
        {
            "hotel_id": "27",
            "hotel_name": "Pride Hotel and Convention Centre, Indore - Hotel in Indore",
            "hotel_code": "h-1",
            "city_id": "8",
            "hotel_image": "",
            "hotel_image_url": ""
        },
        {
            "hotel_id": "28",
            "hotel_name": "Pride Plaza Indore",
            "hotel_code": "h-1",
            "city_id": "8",
            "hotel_image": "",
            "hotel_image_url": ""
        }
    ]
}