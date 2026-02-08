package models

type User struct {
	ID             int64  `json:"id"`
	Login          string `json:"login"`
	FullName       string `json:"full_name"`
	Position       string `json:"position"`
	Role           string `json:"role"`
	DepartmentID   int64  `json:"department_id"`
	DepartmentName string `json:"department_name"`
	AvatarPath     string `json:"-"`
	AvatarURL      string `json:"avatar_url,omitempty"`
}

type Project struct {
	ID            int64  `json:"id"`
	Key           string `json:"key"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	DepartmentID  int64  `json:"department_id"`
	DepartmentName string `json:"department_name"`
	CuratorUserID int64  `json:"curator_user_id"`
	CuratorName   string `json:"curator_name"`
	CuratorNames  string `json:"curator_names"`
	AssigneeNames string `json:"assignee_names"`
	Curators      []User `json:"curators"`
	Assignees     []User `json:"assignees"`
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
	ProjectName   string  `json:"project_name"`
	DepartmentID  int64   `json:"department_id"`
	DepartmentName string `json:"department_name"`
	CuratorUserID int64   `json:"curator_user_id"`
	CuratorName   string  `json:"curator_name"`
	Curators      []User  `json:"curators"`
	DueDate       *string `json:"due_date,omitempty"`
	Assignees     []User  `json:"assignees"`
}

type RegisterInput struct {
	Login          string `json:"login"`
	Password       string `json:"password"`
	RepeatPassword string `json:"repeat_password"`
	FullName       string `json:"full_name"`
	Position       string `json:"position"`
	DepartmentID   int64  `json:"department_id"`
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
	CuratorIDs   []int64 `json:"curator_ids"`
	AssigneeIDs  []int64 `json:"assignee_ids"`
	DueDate      *string `json:"due_date"`
}

type CreateProjectInput struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	DepartmentID int64   `json:"department_id"`
	CuratorIDs   []int64 `json:"curator_ids"`
	AssigneeIDs  []int64 `json:"assignee_ids"`
}

type UpdateProjectInput struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	DepartmentID int64   `json:"department_id"`
	CuratorIDs   []int64 `json:"curator_ids"`
	AssigneeIDs  []int64 `json:"assignee_ids"`
}

type UpdateUserRoleInput struct {
	Role string `json:"role"`
}

type UpdateUserInput struct {
	Login        string `json:"login"`
	FullName     string `json:"full_name"`
	Position     string `json:"position"`
	Role         string `json:"role"`
	DepartmentID int64  `json:"department_id"`
}

type UpdateProfileInput struct {
	FullName string `json:"full_name"`
	Position string `json:"position"`
	Password string `json:"password"`
}

type UpdateTaskInput struct {
	Key         string  `json:"key"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Type        string  `json:"type"`
	Status      string  `json:"status"`
	Priority    string  `json:"priority"`
	ProjectID   int64   `json:"project_id"`
	CuratorIDs  []int64 `json:"curator_ids"`
	AssigneeIDs []int64 `json:"assignee_ids"`
	DueDate     *string `json:"due_date"`
}

type Report struct {
	ID          int64  `json:"id"`
	TargetType  string `json:"target_type"`
	TargetID    int64  `json:"target_id"`
	TargetLabel string `json:"target_label"`
	ResultStatus string `json:"result_status"`
	AuthorID    int64  `json:"author_id"`
	AuthorName  string `json:"author_name"`
	Title       string `json:"title"`
	Resolution  string `json:"resolution"`
	FileName    string `json:"file_name,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
	CreatedAt   string `json:"created_at"`
}

type CreateReportInput struct {
	TargetType string
	TargetID   int64
	ResultStatus string
	AuthorID   int64
	Title      string
	Resolution string
	FileName   string
	FilePath   string
	FileSize   int64
	CloseItem  bool
}

type Department struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type ChatMessage struct {
	ID         int64  `json:"id"`
	ScopeType  string `json:"scope_type"`
	ScopeID    int64  `json:"scope_id"`
	AuthorID   int64  `json:"author_id"`
	AuthorName string `json:"author_name"`
	Body       string `json:"body"`
	CreatedAt  string `json:"created_at"`
}
