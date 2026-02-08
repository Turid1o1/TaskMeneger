package models

type User struct {
	ID       int64  `json:"id"`
	Login    string `json:"login"`
	FullName string `json:"full_name"`
	Position string `json:"position"`
	Role     string `json:"role"`
}

type Project struct {
	ID            int64  `json:"id"`
	Key           string `json:"key"`
	Name          string `json:"name"`
	CuratorUserID int64  `json:"curator_user_id"`
	CuratorName   string `json:"curator_name"`
}

type Task struct {
	ID            int64   `json:"id"`
	Key           string  `json:"key"`
	Title         string  `json:"title"`
	Description   string  `json:"description"`
	Type          string  `json:"type"`
	Status        string  `json:"status"`
	Priority      string  `json:"priority"`
	ProjectID     int64   `json:"project_id"`
	ProjectKey    string  `json:"project_key"`
	CuratorUserID int64   `json:"curator_user_id"`
	CuratorName   string  `json:"curator_name"`
	DueDate       *string `json:"due_date,omitempty"`
	Assignees     []User  `json:"assignees"`
}

type RegisterInput struct {
	Login          string `json:"login"`
	Password       string `json:"password"`
	RepeatPassword string `json:"repeat_password"`
	FullName       string `json:"full_name"`
	Position       string `json:"position"`
}

type LoginInput struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type CreateTaskInput struct {
	Key          string  `json:"key"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	Type         string  `json:"type"`
	Status       string  `json:"status"`
	Priority     string  `json:"priority"`
	ProjectID    int64   `json:"project_id"`
	CuratorID    int64   `json:"curator_id"`
	AssigneeIDs  []int64 `json:"assignee_ids"`
	DueDate      *string `json:"due_date"`
}

type CreateProjectInput struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	CuratorID int64  `json:"curator_id"`
}

type UpdateProjectInput struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	CuratorID int64  `json:"curator_id"`
}

type UpdateUserRoleInput struct {
	Role string `json:"role"`
}
